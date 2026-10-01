/**
 * Review-request emails.
 *
 * Flow: orders/fulfilled webhook → scheduleRequest() stores one row per order
 * (only when the merchant has turned requests on) → the Worker's cron runs
 * processDueRequests() every 15 minutes → one email per order with a
 * "write a review" link per product → the shopper reviews on a page served
 * through the app proxy; reviews from these links are marked verified buyer.
 *
 * Wording is neutral and carries no incentive (FTC Consumer Review Rule):
 * every rating is welcome and nothing is offered in exchange.
 */
import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { reviewRequestTable, reviewUnsubscribeTable } from "./schema";

export type RequestStatus = "scheduled" | "sent" | "skipped" | "failed" | "unsubscribed" | "limit";
export type ReviewRequest = typeof reviewRequestTable.$inferSelect;

export const REQUEST_SENDER = "reviews@storevine.app";
export const DEFAULT_DELAY_DAYS = 7;
const MAX_PRODUCTS_PER_EMAIL = 5;

// ---------------------------------------------------------------- tokens

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Signed, URL-safe token: base64url(JSON).signature. Purpose-bound so a review link can't unsubscribe and vice versa. */
export async function signToken(secret: string, purpose: "review" | "unsub", data: { shop: string; requestId: string }) {
  const body = b64url(enc.encode(JSON.stringify({ p: purpose, s: data.shop, r: data.requestId })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret: string, purpose: "review" | "unsub", token: string | null) {
  if (!token || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { p: string; s: string; r: string };
    if (parsed.p !== purpose || typeof parsed.s !== "string" || typeof parsed.r !== "string") return null;
    return { shop: parsed.s, requestId: parsed.r };
  } catch {
    return null;
  }
}

export async function emailHash(shop: string, email: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${shop}:${email.trim().toLowerCase()}`));
  return b64url(digest);
}

// ---------------------------------------------------------------- scheduling

interface OrderPayload {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  email?: string | null;
  contact_email?: string | null;
  test?: boolean;
  cancelled_at?: string | null;
  customer?: { first_name?: string | null; email?: string | null } | null;
  line_items?: Array<{ product_id?: number | null }>;
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/** Parse an orders/fulfilled payload into what we need. Returns null when there is nothing to ask about. */
export function parseOrder(payload: unknown) {
  const o = (payload ?? {}) as OrderPayload;
  if (o.cancelled_at) return null;
  const email = String(o.email || o.contact_email || o.customer?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  const productIds = [
    ...new Set(
      (o.line_items ?? [])
        .map((li) => li.product_id)
        .filter((id): id is number => typeof id === "number" && id > 0)
        .map((id) => `gid://shopify/Product/${id}`),
    ),
  ].slice(0, MAX_PRODUCTS_PER_EMAIL);
  if (!productIds.length) return null;
  const orderId = o.admin_graphql_api_id || (o.id ? `gid://shopify/Order/${o.id}` : "");
  if (!orderId) return null;
  return {
    orderId,
    orderName: String(o.name ?? "").slice(0, 40),
    email,
    firstName: String(o.customer?.first_name ?? "").trim().slice(0, 60),
    productIds,
  };
}

/** Store a request for later. Idempotent per order (webhook retries, re-fulfilment). */
export async function scheduleRequest(
  db: Db,
  shop: string,
  order: NonNullable<ReturnType<typeof parseOrder>>,
  delayDays: number,
  now = new Date(),
) {
  const sendAfter = new Date(now.getTime() + Math.max(0, delayDays) * 86_400_000).toISOString();
  await db
    .insert(reviewRequestTable)
    .values({
      id: crypto.randomUUID(),
      shop,
      orderId: order.orderId,
      orderName: order.orderName,
      email: order.email,
      firstName: order.firstName,
      productIds: JSON.stringify(order.productIds),
      sendAfter,
      status: "scheduled",
      createdAt: now.toISOString(),
    })
    .onConflictDoNothing();
}

export async function getRequest(db: Db, shop: string, id: string) {
  const [row] = await db
    .select()
    .from(reviewRequestTable)
    .where(and(eq(reviewRequestTable.shop, shop), eq(reviewRequestTable.id, id)));
  return row ?? null;
}

export async function dueRequests(db: Db, now = new Date(), limit = 50) {
  return db
    .select()
    .from(reviewRequestTable)
    .where(and(eq(reviewRequestTable.status, "scheduled"), lte(reviewRequestTable.sendAfter, now.toISOString())))
    .orderBy(asc(reviewRequestTable.sendAfter))
    .limit(limit);
}

export async function markRequest(db: Db, id: string, status: RequestStatus, note: string | null = null, now = new Date()) {
  await db
    .update(reviewRequestTable)
    .set({ status, note, sentAt: status === "sent" ? now.toISOString() : null })
    .where(eq(reviewRequestTable.id, id));
}

export async function sentThisMonth(db: Db, shop: string, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(reviewRequestTable)
    .where(and(eq(reviewRequestTable.shop, shop), eq(reviewRequestTable.status, "sent"), gte(reviewRequestTable.sentAt, start)));
  return Number(row?.n ?? 0);
}

/** Admin view: recent requests (order name + status only; no addresses shown). */
export async function recentRequests(db: Db, shop: string, limit = 20) {
  return db
    .select({
      id: reviewRequestTable.id,
      orderName: reviewRequestTable.orderName,
      status: reviewRequestTable.status,
      note: reviewRequestTable.note,
      sendAfter: reviewRequestTable.sendAfter,
      sentAt: reviewRequestTable.sentAt,
    })
    .from(reviewRequestTable)
    .where(eq(reviewRequestTable.shop, shop))
    .orderBy(sql`${reviewRequestTable.createdAt} desc`)
    .limit(limit);
}

/** Counts for the dashboard and health checks (last `days` days). */
export async function requestStats(db: Db, shop: string, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = await db
    .select({ status: reviewRequestTable.status, n: sql<number>`count(*)` })
    .from(reviewRequestTable)
    .where(and(eq(reviewRequestTable.shop, shop), gte(reviewRequestTable.createdAt, since)))
    .groupBy(reviewRequestTable.status);
  const out: Record<RequestStatus, number> = { scheduled: 0, sent: 0, skipped: 0, failed: 0, unsubscribed: 0, limit: 0 };
  for (const r of rows) out[r.status as RequestStatus] = Number(r.n);
  return out;
}

// ---------------------------------------------------------------- opt-out

export async function unsubscribe(db: Db, shop: string, email: string, now = new Date()) {
  await db
    .insert(reviewUnsubscribeTable)
    .values({ shop, emailHash: await emailHash(shop, email), createdAt: now.toISOString() })
    .onConflictDoNothing();
  // Cancel anything still waiting for this address.
  await db
    .update(reviewRequestTable)
    .set({ status: "unsubscribed" })
    .where(
      and(eq(reviewRequestTable.shop, shop), eq(reviewRequestTable.email, email), eq(reviewRequestTable.status, "scheduled")),
    );
}

export async function isUnsubscribed(db: Db, shop: string, email: string) {
  const [row] = await db
    .select({ h: reviewUnsubscribeTable.emailHash })
    .from(reviewUnsubscribeTable)
    .where(and(eq(reviewUnsubscribeTable.shop, shop), eq(reviewUnsubscribeTable.emailHash, await emailHash(shop, email))));
  return Boolean(row);
}

// ---------------------------------------------------------------- privacy hooks

interface RedactPayload {
  customer?: { email?: string | null };
  orders_requested?: Array<number | string>;
  orders_to_redact?: Array<number | string>;
}

const orderGids = (ids: Array<number | string> | undefined) =>
  (ids ?? []).map((id) => (String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`));

function customerFilter(shop: string, p: RedactPayload, orders: string[]) {
  const email = String(p.customer?.email ?? "").trim().toLowerCase();
  const conds = [];
  if (email) conds.push(eq(reviewRequestTable.email, email));
  if (orders.length) conds.push(inArray(reviewRequestTable.orderId, orders));
  if (!conds.length) return null;
  return and(eq(reviewRequestTable.shop, shop), or(...conds));
}

export async function exportCustomerRequests(db: Db, shop: string, payload: unknown) {
  const p = (payload ?? {}) as RedactPayload;
  const where = customerFilter(shop, p, orderGids(p.orders_requested));
  if (!where) return "No email or orders in request; nothing to export.";
  const rows = await db
    .select({ order: reviewRequestTable.orderName, status: reviewRequestTable.status, sentAt: reviewRequestTable.sentAt })
    .from(reviewRequestTable)
    .where(where);
  return rows.length
    ? `Review requests held: ${JSON.stringify(rows)}. Reviews hold only the display name the customer typed.`
    : "No review-request data held for this customer.";
}

export async function redactCustomerRequests(db: Db, shop: string, payload: unknown) {
  const p = (payload ?? {}) as RedactPayload;
  const where = customerFilter(shop, p, orderGids(p.orders_to_redact));
  if (!where) return "No email or orders in request; nothing to redact.";
  const deleted = await db.delete(reviewRequestTable).where(where).returning({ id: reviewRequestTable.id });
  // The opt-out stays, but only as a one-way hash, so we keep honouring it without holding the address.
  return `Deleted ${deleted.length} review request(s). Opt-out (if any) kept as a one-way hash.`;
}

export async function purgeRequestsShop(db: Db, shop: string) {
  await db.delete(reviewRequestTable).where(eq(reviewRequestTable.shop, shop));
  await db.delete(reviewUnsubscribeTable).where(eq(reviewUnsubscribeTable.shop, shop));
}

// ---------------------------------------------------------------- email

export interface EmailProduct {
  numericId: string;
  title: string;
  imageUrl: string | null;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Build the request email. Pure, so it can be unit-tested. */
export function buildRequestEmail(args: {
  shopName: string;
  firstName: string;
  orderName: string;
  products: EmailProduct[];
  /** Base for review links, e.g. https://store.com/apps/storevine-reviews/write?t=TOKEN */
  writeUrl: string;
  unsubscribeUrl: string;
}) {
  const shop = escapeHtml(args.shopName);
  const greeting = args.firstName ? `Hi ${escapeHtml(args.firstName)},` : "Hi,";
  const link = (p: EmailProduct, rating?: number) =>
    escapeHtml(`${args.writeUrl}&p=${p.numericId}${rating ? `&r=${rating}` : ""}`);
  const one = args.products.length === 1;
  const subject = one
    ? `How is your ${args.products[0].title.slice(0, 60)}?`
    : `How was your order from ${args.shopName.slice(0, 60)}?`;

  const rows = args.products
    .map((p) => {
      const stars = [1, 2, 3, 4, 5]
        .map(
          (r) =>
            `<a href="${link(p, r)}" style="text-decoration:none;font-size:26px;color:#f5a623;padding:0 2px" aria-label="${r} star${r > 1 ? "s" : ""}">&#9733;</a>`,
        )
        .join("");
      const img = p.imageUrl
        ? `<img src="${escapeHtml(p.imageUrl)}" width="72" height="72" alt="" style="border-radius:6px;object-fit:cover;display:block">`
        : "";
      return `<tr>
  <td style="padding:12px 12px 12px 0;vertical-align:top;width:72px">${img}</td>
  <td style="padding:12px 0;vertical-align:top">
    <div style="font-weight:600;margin-bottom:6px">${escapeHtml(p.title)}</div>
    <div>${stars}</div>
    <a href="${link(p)}" style="display:inline-block;margin-top:8px;color:#1a1a1a">Write a review</a>
  </td>
</tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f6">
<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5">
<div style="background:#fff;border-radius:10px;padding:24px">
<p style="margin-top:0">${greeting}</p>
<p>Thanks for your order${args.orderName ? ` ${escapeHtml(args.orderName)}` : ""} from ${shop}. Would you share what you think? Every honest review helps other shoppers, whatever the rating.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows}</table>
<p style="margin-bottom:0">Thank you,<br>${shop}</p>
</div>
<p style="font-size:12px;color:#6b6b6b;text-align:center;margin-top:16px">You're receiving this because you ordered from ${shop}.
<a href="${escapeHtml(args.unsubscribeUrl)}" style="color:#6b6b6b">Don't send me review requests</a></p>
</div></body></html>`;

  const text = [
    greeting,
    "",
    `Thanks for your order${args.orderName ? ` ${args.orderName}` : ""} from ${args.shopName}. Would you share what you think? Every honest review helps other shoppers, whatever the rating.`,
    "",
    ...args.products.map((p) => `${p.title}: ${args.writeUrl}&p=${p.numericId}`),
    "",
    `Thank you,`,
    args.shopName,
    "",
    `Don't send me review requests: ${args.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------- sending (cron)

export interface SendDeps {
  db: Db;
  secret: string;
  appUrl: string;
  /** Cloudflare Email Service binding; absent until the sending domain is onboarded. */
  email: { send(message: Record<string, unknown>): Promise<{ messageId?: string }> } | undefined;
  /** Per-shop context: settings, plan limit, and an Admin API client. */
  shopContext(shop: string): Promise<{
    enabled: boolean;
    monthlyLimit: number;
    shopName: string;
    replyTo: string | null;
    storefrontUrl: string;
    products(ids: string[]): Promise<EmailProduct[]>;
  } | null>;
}

/** Send every due request (called by the cron trigger). Returns counts for logging. */
export async function processDueRequests(deps: SendDeps, now = new Date()) {
  const counts: Record<RequestStatus, number> = { scheduled: 0, sent: 0, skipped: 0, failed: 0, unsubscribed: 0, limit: 0 };
  if (!deps.email) return counts; // nothing can be sent yet; requests wait
  const due = await dueRequests(deps.db, now);
  const ctxCache = new Map<string, Awaited<ReturnType<SendDeps["shopContext"]>>>();
  const sentCache = new Map<string, number>();

  for (const req of due) {
    const mark = async (status: RequestStatus, note: string | null = null) => {
      await markRequest(deps.db, req.id, status, note, now);
      counts[status]++;
    };
    try {
      if (!ctxCache.has(req.shop)) ctxCache.set(req.shop, await deps.shopContext(req.shop));
      const ctx = ctxCache.get(req.shop);
      if (!ctx) { await mark("skipped", "App not installed"); continue; }
      if (!ctx.enabled) { await mark("skipped", "Review requests are turned off"); continue; }
      if (await isUnsubscribed(deps.db, req.shop, req.email)) { await mark("unsubscribed"); continue; }
      if (!sentCache.has(req.shop)) sentCache.set(req.shop, await sentThisMonth(deps.db, req.shop, now));
      if ((sentCache.get(req.shop) ?? 0) >= ctx.monthlyLimit) { await mark("limit", "Monthly request limit reached"); continue; }

      const products = await ctx.products(JSON.parse(req.productIds) as string[]);
      if (!products.length) { await mark("skipped", "Products no longer available"); continue; }

      const writeToken = await signToken(deps.secret, "review", { shop: req.shop, requestId: req.id });
      const unsubToken = await signToken(deps.secret, "unsub", { shop: req.shop, requestId: req.id });
      const writeUrl = `${ctx.storefrontUrl.replace(/\/$/, "")}/apps/storevine-reviews/write?t=${writeToken}`;
      const unsubscribeUrl = `${deps.appUrl.replace(/\/$/, "")}/unsubscribe?t=${unsubToken}`;
      const { subject, html, text } = buildRequestEmail({
        shopName: ctx.shopName,
        firstName: req.firstName,
        orderName: req.orderName,
        products,
        writeUrl,
        unsubscribeUrl,
      });
      const result = await deps.email.send({
        to: req.email,
        from: { email: REQUEST_SENDER, name: ctx.shopName.slice(0, 70) },
        ...(ctx.replyTo ? { replyTo: ctx.replyTo } : {}),
        subject,
        html,
        text,
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      sentCache.set(req.shop, (sentCache.get(req.shop) ?? 0) + 1);
      await mark("sent", result?.messageId ? `id ${String(result.messageId).slice(0, 80)}` : null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("review request send failed", req.id, message);
      // Suppressed recipients (bounces/complaints) shouldn't be retried.
      await mark("failed", message.slice(0, 200));
    }
  }
  return counts;
}

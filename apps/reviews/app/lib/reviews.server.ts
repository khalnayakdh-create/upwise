import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@upwise/platform";
import { appSettingTable, reviewTable } from "./schema";

export type ReviewStatus = "published" | "pending" | "hidden";
export type Review = typeof reviewTable.$inferSelect;

export interface Settings {
  /** true: new storefront reviews go live immediately; false: they wait in the inbox. */
  autoPublish: boolean;
}
/** New installs hold reviews for approval (safer against spam); merchants can switch to auto-publish. */
export const DEFAULT_SETTINGS: Settings = { autoPublish: false };

export async function getSettings(db: Db, shop: string): Promise<Settings> {
  const [row] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, "settings")));
  if (!row) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(db: Db, shop: string, settings: Settings) {
  const value = JSON.stringify(settings);
  await db
    .insert(appSettingTable)
    .values({ shop, key: "settings", value })
    .onConflictDoUpdate({ target: [appSettingTable.shop, appSettingTable.key], set: { value } });
}

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);

export interface SubmissionInput {
  productId: string;
  rating: number;
  title: string;
  body: string;
  author: string;
}

/** Validate a storefront submission. Honeypot + minimum fill time block simple bots. */
export function validateSubmission(raw: Record<string, unknown>, now = Date.now()): { input?: SubmissionInput; error?: string } {
  if (clean(raw.website, 200)) return { error: "spam" }; // honeypot
  const startedAt = Number(raw.startedAt);
  if (!Number.isFinite(startedAt) || now - startedAt < 2500 || now - startedAt > 86_400_000) return { error: "spam" };
  const productNumeric = clean(raw.productId, 30);
  if (!/^\d+$/.test(productNumeric)) return { error: "Unknown product." };
  const rating = Number.parseInt(String(raw.rating ?? ""), 10);
  if (!(rating >= 1 && rating <= 5)) return { error: "Choose a star rating." };
  const author = clean(raw.author, 60);
  const body = clean(raw.body, 2000);
  if (!author) return { error: "Add your name." };
  if (body.length < 3) return { error: "Write a few words about the product." };
  return {
    input: { productId: `gid://shopify/Product/${productNumeric}`, rating, title: clean(raw.title, 120), body, author },
  };
}

export async function createReview(
  db: Db,
  shop: string,
  input: SubmissionInput & { productHandle?: string; productTitle?: string; status: ReviewStatus; source?: "storefront" | "import"; createdAt?: string },
  now = new Date(),
) {
  const id = crypto.randomUUID();
  const ts = input.createdAt ?? now.toISOString();
  await db.insert(reviewTable).values({
    id,
    shop,
    productId: input.productId,
    productHandle: input.productHandle ?? "",
    productTitle: input.productTitle ?? "",
    rating: input.rating,
    title: input.title,
    body: input.body,
    author: input.author,
    status: input.status,
    source: input.source ?? "storefront",
    createdAt: ts,
    updatedAt: now.toISOString(),
  });
  return id;
}

/** Storefront submissions in the last hour for a shop (simple flood protection). */
export async function recentSubmissions(db: Db, shop: string, now = new Date()) {
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(reviewTable)
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.source, "storefront"), gte(reviewTable.createdAt, since)));
  return Number(row?.n ?? 0);
}
export const MAX_SUBMISSIONS_PER_HOUR = 30;

export async function listReviews(db: Db, shop: string, opts: { status?: ReviewStatus; limit?: number; offset?: number } = {}) {
  const where = opts.status
    ? and(eq(reviewTable.shop, shop), eq(reviewTable.status, opts.status))
    : eq(reviewTable.shop, shop);
  return db
    .select()
    .from(reviewTable)
    .where(where)
    .orderBy(desc(reviewTable.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function publishedForProduct(db: Db, shop: string, productId: string, limit = 10, offset = 0) {
  return db
    .select({
      id: reviewTable.id,
      rating: reviewTable.rating,
      title: reviewTable.title,
      body: reviewTable.body,
      author: reviewTable.author,
      reply: reviewTable.reply,
      createdAt: reviewTable.createdAt,
    })
    .from(reviewTable)
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.productId, productId), eq(reviewTable.status, "published")))
    .orderBy(desc(reviewTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export interface Summary {
  count: number;
  average: number; // 0 when no reviews
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

export async function productSummary(db: Db, shop: string, productId: string): Promise<Summary> {
  const rows = await db
    .select({ rating: reviewTable.rating, n: sql<number>`count(*)` })
    .from(reviewTable)
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.productId, productId), eq(reviewTable.status, "published")))
    .groupBy(reviewTable.rating);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Summary["distribution"];
  let count = 0;
  let total = 0;
  for (const r of rows) {
    const k = r.rating as 1 | 2 | 3 | 4 | 5;
    distribution[k] = Number(r.n);
    count += Number(r.n);
    total += Number(r.n) * r.rating;
  }
  return { count, average: count ? Math.round((total / count) * 10) / 10 : 0, distribution };
}

export async function setStatus(db: Db, shop: string, id: string, status: ReviewStatus) {
  const [row] = await db
    .update(reviewTable)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.id, id)))
    .returning({ productId: reviewTable.productId });
  return row?.productId ?? null;
}

export async function setReply(db: Db, shop: string, id: string, reply: string) {
  await db
    .update(reviewTable)
    .set({ reply: clean(reply, 1000) || null, updatedAt: new Date().toISOString() })
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.id, id)));
}

export async function deleteReview(db: Db, shop: string, id: string) {
  const [row] = await db
    .delete(reviewTable)
    .where(and(eq(reviewTable.shop, shop), eq(reviewTable.id, id)))
    .returning({ productId: reviewTable.productId });
  return row?.productId ?? null;
}

export async function shopTotals(db: Db, shop: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      published: sql<number>`sum(case when ${reviewTable.status} = 'published' then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${reviewTable.status} = 'pending' then 1 else 0 end)`,
      avg: sql<number>`avg(case when ${reviewTable.status} = 'published' then ${reviewTable.rating} end)`,
    })
    .from(reviewTable)
    .where(eq(reviewTable.shop, shop));
  return {
    total: Number(row?.total ?? 0),
    published: Number(row?.published ?? 0),
    pending: Number(row?.pending ?? 0),
    average: row?.avg ? Math.round(Number(row.avg) * 10) / 10 : 0,
  };
}

const importKey = (now: Date) => `imported:${now.toISOString().slice(0, 7)}`;

/** Monthly import counter (kept separately so deleting imported reviews doesn't reset it). */
export async function importedThisMonth(db: Db, shop: string, now = new Date()) {
  const [row] = await db
    .select({ value: appSettingTable.value })
    .from(appSettingTable)
    .where(and(eq(appSettingTable.shop, shop), eq(appSettingTable.key, importKey(now))));
  return Number(row?.value ?? 0);
}

export async function addImported(db: Db, shop: string, n: number, now = new Date()) {
  const key = importKey(now);
  await db
    .insert(appSettingTable)
    .values({ shop, key, value: String(n) })
    .onConflictDoUpdate({
      target: [appSettingTable.shop, appSettingTable.key],
      set: { value: sql`CAST(CAST(${appSettingTable.value} AS INTEGER) + ${n} AS TEXT)` },
    });
}

export async function purgeReviewsShop(db: Db, shop: string) {
  await db.delete(reviewTable).where(eq(reviewTable.shop, shop));
  await db.delete(appSettingTable).where(eq(appSettingTable.shop, shop));
}

/** Parse CSV with header: product_handle,rating,title,body,author,created_at (quoted fields supported). */
export function parseReviewCsv(text: string): { rows: Array<Record<string, string>>; errors: string[] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.some((f) => f.trim())) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f.trim())) records.push(record);
  if (!records.length) return { rows: [], errors: ["The file is empty."] };
  const header = records[0].map((h) => h.trim().toLowerCase());
  const required = ["product_handle", "rating", "body", "author"];
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}`] };
  const rows = records.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const rating = Number(r.rating);
    if (!(rating >= 1 && rating <= 5)) errors.push(`Row ${i + 2}: rating must be 1-5`);
    if (!r.product_handle) errors.push(`Row ${i + 2}: product_handle is required`);
  });
  return { rows, errors };
}

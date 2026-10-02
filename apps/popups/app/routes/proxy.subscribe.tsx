import type { Route } from "./+types/proxy.subscribe";
import { getDb, shopTable } from "@upwise/platform";
import { eq } from "drizzle-orm";
import { getShopify } from "../shopify.server";
import { createUniqueCode, subscribeCustomer, writeConsentRecord } from "../lib/admin.server";
import { bump, getConfig, screenSignup, uniqueCode } from "../lib/popup.server";
import { isDisposable } from "../lib/disposable";
import { PLAN_LIMITS } from "../lib/plans";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

/** Shopper IP as forwarded by Shopify's app proxy, if present (never stored). */
function clientIp(request: Request) {
  const xff = request.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0].trim() : null;
}

/** POST /apps/storevine-popups/subscribe {email, consent: true, elapsed, page} — signed by Shopify's app proxy. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session, admin } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session || !admin) return json({ error: "not installed" }, 404);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const db = getDb(env.DB);
  const shop = session.shop;

  // Bot shield: rate limits per shopper IP and per store, then form checks.
  const limits = env as unknown as { SIGNUP_IP?: RateLimiter; SIGNUP_SHOP?: RateLimiter };
  const ip = clientIp(request);
  const ipOk = !ip || !limits.SIGNUP_IP || (await limits.SIGNUP_IP.limit({ key: `${shop}:${ip}` })).success;
  const shopOk = !limits.SIGNUP_SHOP || (await limits.SIGNUP_SHOP.limit({ key: shop })).success;
  if (!ipOk || !shopOk) {
    await bump(db, shop, "blocked");
    return json({ error: "Too many sign-ups right now. Please try again in a minute." }, 429);
  }
  const screened = screenSignup(body, isDisposable);
  if (!screened.ok) {
    if (screened.blocked) {
      await bump(db, shop, "blocked");
      return screened.error ? json({ error: screened.error }, 400) : json({ ok: true });
    }
    return json({ error: screened.error }, screened.status);
  }

  const config = await getConfig(db, shop);
  const [row] = await db.select({ plan: shopTable.plan }).from(shopTable).where(eq(shopTable.shop, shop));
  const plan = row?.plan === "growth" ? "growth" : "free";
  const graphql = admin.graphql as never;
  let result: Awaited<ReturnType<typeof subscribeCustomer>>;
  try {
    result = await subscribeCustomer(graphql, screened.email);
  } catch (error) {
    // Log Shopify's reason (e.g. protected customer data not approved), not just the stack.
    const e = error as { message?: string; response?: { status?: number }; body?: unknown };
    console.error("subscribeCustomer failed", e?.message, e?.response?.status, JSON.stringify(e?.body ?? null));
    return json({ error: "We couldn't sign you up right now. Please try again." }, 502);
  }
  await bump(db, shop, "signups");

  const isNew = result.status === "created" || result.status === "updated";
  if (isNew && result.customerId) {
    const page = String(body.page ?? "").split("?")[0].slice(0, 200) || "/";
    await writeConsentRecord(graphql, result.customerId, {
      text: config.consentText,
      page,
      at: new Date().toISOString(),
      source: "Storevine pop-up",
      optInLevel: "SINGLE_OPT_IN",
    }).catch((e) => console.error("consent record failed", e instanceof Error ? e.message : e));
  }

  let discountCode: string | null = config.discountCode || null;
  if (config.codeMode === "unique" && PLAN_LIMITS[plan].uniqueCodes) {
    // One code per new subscriber; existing subscribers can't farm more.
    discountCode = null;
    if (isNew && result.customerId) {
      try {
        discountCode = await createUniqueCode(graphql, {
          code: uniqueCode(),
          customerId: result.customerId,
          percent: config.uniquePercent,
          days: config.uniqueDays,
        });
      } catch (e) {
        // Missing write_discounts approval or a Shopify error: fall back to the shared code, if any.
        console.error("unique code failed", e instanceof Error ? e.message : e);
        discountCode = config.discountCode || null;
      }
    }
  }
  return json({ ok: true, discountCode });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

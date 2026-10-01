import type { Route } from "./+types/proxy.subscribe";
import { getDb, shopTable } from "@upwise/platform";
import { eq } from "drizzle-orm";
import { getShopify } from "../shopify.server";
import { subscribeCustomer } from "../lib/admin.server";
import { bump, signupsThisMonth, validEmail } from "../lib/popup.server";
import { PLAN_LIMITS } from "../lib/plans";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** POST /apps/upwise-popups/subscribe {email, consent: true} — signed by Shopify's app proxy. */
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
  if (body.website) return json({ ok: true }); // honeypot
  if (body.consent !== true) return json({ error: "Please agree to receive emails." }, 400);
  const email = validEmail(body.email);
  if (!email) return json({ error: "Enter a valid email address." }, 400);

  const db = getDb(env.DB);
  // Plan is cached on the shop row whenever the merchant opens the app.
  const [row] = await db.select({ plan: shopTable.plan }).from(shopTable).where(eq(shopTable.shop, session.shop));
  const plan = row?.plan === "growth" ? "growth" : "free";
  const limit = PLAN_LIMITS[plan].signupsPerMonth;
  if (Number.isFinite(limit) && (await signupsThisMonth(db, session.shop)) >= limit) {
    return json({ error: "Sign-ups are paused right now. Please try again later." }, 429);
  }
  try {
    await subscribeCustomer(admin.graphql as never, email);
  } catch (error) {
    console.error("subscribeCustomer failed", error);
    return json({ error: "We couldn't sign you up right now. Please try again." }, 502);
  }
  await bump(db, session.shop, "signups");
  return json({ ok: true });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

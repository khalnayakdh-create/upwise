import type { Route } from "./+types/proxy.events";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { listOffers, recordStats, type StatType } from "../lib/offers.server";
import { recordCarts } from "../lib/attribution.server";

const TYPES = new Set<StatType>(["impression", "click", "add"]);

/**
 * Storefront analytics, reached through the Shopify app proxy
 * (https://{shop}/apps/storevine-cart/events -> /proxy/events).
 * Shopify signs the request; authenticate.public.appProxy verifies it.
 * Only offer IDs, event types and holdout-group cart counts are stored — nothing about the shopper.
 */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session) return new Response(null, { status: 204 });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const raw = (body as { events?: unknown })?.events;
  if (!Array.isArray(raw)) return new Response("no events", { status: 400 });
  const events = raw
    .slice(0, 25)
    .filter(
      (e): e is { offerId: string; type: StatType } =>
        !!e && typeof e.offerId === "string" && TYPES.has(e.type),
    );
  const carts = { h: 0, s: 0 };
  for (const e of raw.slice(0, 25)) {
    if (e && e.type === "cart" && (e.group === "h" || e.group === "s")) carts[e.group as "h" | "s"]++;
  }
  const db = getDb(env.DB);
  if (carts.h || carts.s) await recordCarts(db, session.shop, carts);
  const valid = new Set((await listOffers(db, session.shop)).map((o) => o.id));
  await recordStats(db, session.shop, events, valid);
  return new Response(null, { status: 204 });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

import type { Route } from "./+types/proxy.events";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { listOffers, recordStats, type StatType } from "../lib/offers.server";

const TYPES = new Set<StatType>(["impression", "click", "add"]);

/**
 * Storefront analytics, reached through the Shopify app proxy
 * (https://{shop}/apps/storevine-cart/events -> /proxy/events).
 * Shopify signs the request; authenticate.public.appProxy verifies it.
 * Only offer IDs and event types are stored — nothing about the shopper.
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
  const db = getDb(env.DB);
  const valid = new Set((await listOffers(db, session.shop)).map((o) => o.id));
  await recordStats(db, session.shop, events, valid);
  return new Response(null, { status: 204 });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

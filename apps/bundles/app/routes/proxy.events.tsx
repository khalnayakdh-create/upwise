import type { Route } from "./+types/proxy.events";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { listBundles, recordBundleEvents } from "../lib/bundles.server";

/** POST /apps/storevine-bundles/events {events:[{bundleId,type}]} — anonymous daily counts. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session) return new Response(null, { status: 204 });
  let raw: unknown;
  try { raw = (JSON.parse(await request.text()) as { events?: unknown }).events; } catch { return new Response("bad json", { status: 400 }); }
  if (!Array.isArray(raw)) return new Response("no events", { status: 400 });
  const events = raw.slice(0, 25).filter((e): e is { bundleId: string; type: "impression" | "add" } =>
    !!e && typeof e.bundleId === "string" && (e.type === "impression" || e.type === "add"));
  const db = getDb(env.DB);
  const valid = new Set((await listBundles(db, session.shop)).map((b) => b.id));
  await recordBundleEvents(db, session.shop, events, valid);
  return new Response(null, { status: 204 });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

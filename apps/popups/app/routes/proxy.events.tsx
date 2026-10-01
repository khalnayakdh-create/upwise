import type { Route } from "./+types/proxy.events";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { bump } from "../lib/popup.server";

/** POST /apps/upwise-popups/events {type: "impression"} — anonymous daily count. */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session) return new Response(null, { status: 204 });
  let type = "";
  try {
    type = String((JSON.parse(await request.text()) as { type?: string }).type ?? "");
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (type === "impression") await bump(getDb(env.DB), session.shop, "impressions");
  return new Response(null, { status: 204 });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

import type { Route } from "./+types/webhooks.compliance";
import { eq } from "drizzle-orm";
import { getDb, shopTable } from "@upwise/platform";
import { shared } from "../shopify.server";
import { purgeShopPhotos } from "../lib/photos.server";

export const action = async (args: Route.ActionArgs) => {
  const topic = args.request.headers.get("X-Shopify-Topic") ?? "";
  const shop = args.request.headers.get("X-Shopify-Shop-Domain") ?? "";
  const response = await shared.compliance(args as never);
  // shop/redact deleted the database rows (unless the shop reinstalled); remove its photos too.
  if (topic === "shop/redact" && shop) {
    const { env } = args.context.cloudflare;
    const [row] = await getDb(env.DB).select({ shop: shopTable.shop }).from(shopTable).where(eq(shopTable.shop, shop));
    if (!row) await purgeShopPhotos(env, shop);
  }
  return response;
};

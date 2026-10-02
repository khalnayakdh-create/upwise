import type { Route } from "./+types/api.admin-block";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { productAdminSummary } from "../lib/reviews.server";

/**
 * Data for the "Storevine reviews" block on the admin product page
 * (admin.product-details.block.render). The extension's fetch carries a
 * session token; authenticate.admin verifies it and cors() adds the headers.
 */
export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session, cors } = await getShopify(env).authenticate.admin(request);
  const id = new URL(request.url).searchParams.get("product") ?? "";
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(id)) return cors(Response.json({ error: "bad product" }, { status: 400 }));
  return cors(Response.json(await productAdminSummary(getDb(env.DB), session.shop, id)));
};

/** CORS preflight (OPTIONS) reaches the action; authenticate.admin answers it. */
export const action = async (args: Route.ActionArgs) => loader(args as unknown as Route.LoaderArgs);

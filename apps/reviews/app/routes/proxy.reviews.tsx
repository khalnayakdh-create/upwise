import type { Route } from "./+types/proxy.reviews";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { productInfo, syncProductRating } from "../lib/admin.server";
import { createReview, getSettings, productSummary, publishedForProduct, validateSubmission } from "../lib/reviews.server";

/**
 * Storefront API via the Shopify app proxy:
 *   GET  /apps/upwise-reviews/reviews?product_id=123&page=1 -> summary + published reviews
 *   POST /apps/upwise-reviews/reviews (form data)           -> submit a review
 * Requests are signed by Shopify (verified by authenticate.public.appProxy).
 */
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session) return json({ error: "not installed" }, 404);
  const url = new URL(request.url);
  const numeric = url.searchParams.get("product_id") ?? "";
  if (!/^\d+$/.test(numeric)) return json({ error: "product_id required" }, 400);
  const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page")) || 1));
  const productId = `gid://shopify/Product/${numeric}`;
  const db = getDb(env.DB);
  const [summary, reviews] = await Promise.all([
    productSummary(db, session.shop, productId),
    publishedForProduct(db, session.shop, productId, 10, (page - 1) * 10),
  ]);
  return json({ summary, reviews, page, hasMore: page * 10 < summary.count });
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session, admin } = await getShopify(env).authenticate.public.appProxy(request);
  if (!session || !admin) return json({ error: "not installed" }, 404);
  const form = Object.fromEntries(await request.formData());
  const { input, error } = validateSubmission(form);
  if (error === "spam") return json({ ok: true, status: "pending" }); // don't tell bots
  if (!input) return json({ error }, 400);
  const product = await productInfo(admin.graphql as never, input.productId);
  if (!product) return json({ error: "Unknown product." }, 400);
  const db = getDb(env.DB);
  const { autoPublish } = await getSettings(db, session.shop);
  const status = autoPublish ? "published" : "pending";
  await createReview(db, session.shop, { ...input, productHandle: product.handle, productTitle: product.title, status });
  if (status === "published") await syncProductRating(admin.graphql as never, env, session.shop, input.productId);
  return json({ ok: true, status });
};

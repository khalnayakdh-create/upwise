import type { Route } from "./+types/write";
import { getDb } from "@upwise/platform";
import { gql, type GraphqlFn } from "@upwise/shopify-app";
import { getShopify } from "../shopify.server";
import { syncProductRating } from "../lib/admin.server";
import { createReview, getSettings, reviewedFromRequest, validateRequestReview } from "../lib/reviews.server";
import { getRequest, verifyToken } from "../lib/requests.server";
import { deletePhotos, savePhotos } from "../lib/photos.server";
import { errorCode } from "../lib/write-errors";

/**
 * POST {APP_URL}/write — the review form from request emails posts here directly
 * (multipart, with photos). The signed token proves which shop and order it is.
 * Always redirects back to the store's review page, never to a caller-supplied URL.
 */
export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const token = String(form.get("t") ?? "");
  const claim = await verifyToken(env.SHOPIFY_API_SECRET, "review", token);
  if (!claim) return new Response("This link isn't valid.", { status: 400 });
  const db = getDb(env.DB);
  const req = await getRequest(db, claim.shop, claim.requestId);
  if (!req) return new Response("This link has expired.", { status: 410 });

  let graphql: GraphqlFn;
  try {
    graphql = (await getShopify(env).unauthenticated.admin(claim.shop)).admin.graphql as never;
  } catch {
    return new Response("This store no longer uses Storevine Reviews.", { status: 410 });
  }
  const { shop: info } = await gql<{ shop: { primaryDomain: { url: string } } }>(
    graphql,
    `#graphql
    query StorevineWriteShop { shop { primaryDomain { url } } }`,
  );
  const numeric = String(form.get("p") ?? "").replace(/\D/g, "");
  const back = (params: Record<string, string>) => {
    const u = new URL("/apps/storevine-reviews/write", info.primaryDomain.url);
    u.searchParams.set("t", token);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return Response.redirect(u.toString(), 303);
  };

  const productId = `gid://shopify/Product/${numeric}`;
  if (!(JSON.parse(req.productIds) as string[]).includes(productId)) return back({ e: "failed" });
  const done = await reviewedFromRequest(db, claim.shop, req.id);
  if (done.has(productId)) return back({ done: numeric, s: "pending" });

  const raw: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") raw[k] = v;
  const { input, error } = validateRequestReview(raw);
  if (!input) return back({ p: numeric, e: errorCode(error), ...(raw.rating ? { r: raw.rating } : {}) });

  const files = form.getAll("photos").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const photos = await savePhotos(env, claim.shop, files);
  if (photos.error) return back({ p: numeric, e: photos.error, r: String(input.rating) });

  const product = await gql<{ product: { title: string; handle: string } | null }>(
    graphql,
    `#graphql
    query StorevineWriteProduct($id: ID!) { product(id: $id) { title handle } }`,
    { id: productId },
  );
  const { autoPublish } = await getSettings(db, claim.shop);
  const status = autoPublish ? "published" : "pending";
  try {
    await createReview(db, claim.shop, {
      ...input,
      productId,
      productTitle: product.product?.title ?? "",
      productHandle: product.product?.handle ?? "",
      status,
      source: "request",
      verified: true,
      requestId: req.id,
      photos: photos.keys,
    });
  } catch {
    await deletePhotos(env, photos.keys); // duplicate submit: don't keep orphan photos
    return back({ done: numeric, s: "pending" });
  }
  if (status === "published") await syncProductRating(graphql, env, claim.shop, productId);
  return back({ done: numeric, s: status });
};

export const loader = () => new Response("Method not allowed", { status: 405 });

import type { Route } from "./+types/app.import";
import type { HeadersFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { productsByHandle, resolvePlan, syncProductRating } from "../lib/admin.server";
import { createReview, importedThisMonth, parseReviewCsv } from "../lib/reviews.server";
import { PLAN_LIMITS } from "../lib/plans";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session, billing } = await getShopify(env).authenticate.admin(request);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  const used = await importedThisMonth(getDb(env.DB), session.shop);
  const limit = PLAN_LIMITS[plan].importPerMonth;
  return { remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const form = await request.formData();
  const file = form.get("file");
  const text = file instanceof File && file.size ? await file.text() : String(form.get("csv") ?? "");
  if (text.length > 2_000_000) return { error: "File is too large (2 MB max).", imported: 0, skipped: [] as string[] };
  const { rows, errors } = parseReviewCsv(text);
  if (errors.length && !rows.length) return { error: errors.join(" "), imported: 0, skipped: [] as string[] };

  const { plan } = await resolvePlan(billing as never, env, session.shop);
  const limit = PLAN_LIMITS[plan].importPerMonth;
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - (await importedThisMonth(db, session.shop))) : rows.length;
  const products = await productsByHandle(admin.graphql as never, rows.map((r) => r.product_handle));
  const skipped: string[] = [...errors];
  const touched = new Set<string>();
  let imported = 0;
  for (const [i, r] of rows.entries()) {
    if (imported >= remaining) {
      skipped.push(`Row ${i + 2}: monthly import limit reached`);
      continue;
    }
    const product = products.get(r.product_handle);
    const rating = Number(r.rating);
    if (!product) { skipped.push(`Row ${i + 2}: no product with handle "${r.product_handle}"`); continue; }
    if (!(rating >= 1 && rating <= 5) || !r.body || !r.author) continue;
    const created = r.created_at && !Number.isNaN(Date.parse(r.created_at)) ? new Date(r.created_at).toISOString() : undefined;
    await createReview(db, session.shop, {
      productId: product.id,
      productHandle: r.product_handle,
      productTitle: product.title,
      rating: Math.round(rating),
      title: (r.title ?? "").slice(0, 120),
      body: r.body.slice(0, 2000),
      author: r.author.slice(0, 60),
      status: "published",
      source: "import",
      createdAt: created,
    });
    touched.add(product.id);
    imported++;
  }
  for (const productId of touched) await syncProductRating(admin.graphql as never, env, session.shop, productId);
  return { error: null, imported, skipped: skipped.slice(0, 20) };
};

export default function Import() {
  const { remaining } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state === "submitting";
  return (
    <s-page heading="Import reviews">
      {result?.error ? <s-banner tone="critical" heading="Import failed">{result.error}</s-banner> : null}
      {result && !result.error ? (
        <s-banner tone={result.skipped.length ? "warning" : "success"} heading={`Imported ${result.imported} reviews`}>
          {result.skipped.length ? (
            <s-unordered-list>{result.skipped.map((s) => <s-list-item key={s}>{s}</s-list-item>)}</s-unordered-list>
          ) : null}
        </s-banner>
      ) : null}
      <Form method="post" encType="multipart/form-data">
        <s-section heading="CSV file">
          <s-stack gap="base">
            <s-paragraph>
              Columns: <s-text type="strong">product_handle, rating, body, author</s-text> (required) and optional{" "}
              <s-text type="strong">title, created_at</s-text>. Only import genuine reviews from real customers.
            </s-paragraph>
            {remaining !== null ? <s-text color="subdued">{remaining} imports left this month on your plan.</s-text> : null}
            <input type="file" name="file" accept=".csv,text/csv" aria-label="CSV file" />
            <s-text-area label="…or paste CSV" name="csv" rows={6} />
            <s-button type="submit" variant="primary" loading={busy}>Import</s-button>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

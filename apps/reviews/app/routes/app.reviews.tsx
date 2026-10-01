import type { Route } from "./+types/app.reviews";
import type { HeadersFunction } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { getShopify } from "../shopify.server";
import { syncProductRating } from "../lib/admin.server";
import { deleteReview, listReviews, setReply, setStatus, type ReviewStatus } from "../lib/reviews.server";
import { deletePhotos, parsePhotos, signedPhotoUrl } from "../lib/photos.server";

const STATUSES: ReviewStatus[] = ["published", "pending", "hidden"];

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const url = new URL(request.url);
  const status = STATUSES.find((s) => s === url.searchParams.get("status"));
  const rows = await listReviews(getDb(env.DB), session.shop, { status, limit: 100 });
  // Photos of unpublished reviews aren't public, so the admin gets short-lived signed links.
  const reviews = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      photoUrls: await Promise.all(parsePhotos(r.photos).map((k) => signedPhotoUrl(env.SHOPIFY_APP_URL, env.SHOPIFY_API_SECRET, k))),
    })),
  );
  return { status: status ?? "all", reviews };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "");
  let productId: string | null = null;
  if (intent === "reply") {
    await setReply(db, session.shop, id, String(form.get("reply") ?? ""));
    return { ok: true };
  }
  if (intent === "delete") {
    const removed = await deleteReview(db, session.shop, id);
    if (removed) await deletePhotos(env, parsePhotos(removed.photos));
    productId = removed?.productId ?? null;
  }
  else if (STATUSES.includes(intent as ReviewStatus)) productId = await setStatus(db, session.shop, id, intent as ReviewStatus);
  if (productId) await syncProductRating(admin.graphql as never, env, session.shop, productId);
  return { ok: true };
};

function Stars({ n }: { n: number }) {
  return <s-text>{"★".repeat(n) + "☆".repeat(5 - n)}<s-text accessibilityVisibility="exclusive">{` ${n} out of 5 stars`}</s-text></s-text>;
}

type Row = Awaited<ReturnType<typeof listReviews>>[number] & { photoUrls: string[] };

function ReviewRow({ review }: { review: Row }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const [replying, setReplying] = useState(false);
  const [reply, setReplyText] = useState(review.reply ?? "");
  const act = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit({ id: review.id, intent, ...extra }, { method: "post" });
  return (
    <s-section>
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small" alignItems="center">
            <Stars n={review.rating} />
            <s-text type="strong">{review.title || review.body.slice(0, 60)}</s-text>
          </s-stack>
          <s-badge tone={review.status === "published" ? "success" : review.status === "pending" ? "caution" : undefined}>
            {review.status === "published" ? "Published" : review.status === "pending" ? "Pending" : "Hidden"}
          </s-badge>
        </s-stack>
        <s-text color="subdued">
          {review.author} on {review.productTitle || review.productHandle} · {new Date(review.createdAt).toLocaleDateString()}
          {review.source === "import" ? " · Imported" : review.source === "request" ? " · From review request" : ""}
          {review.verified ? " · Verified buyer" : ""}
        </s-text>
        <s-paragraph>{review.body}</s-paragraph>
        {review.photoUrls.length ? (
          <s-stack direction="inline" gap="small">
            {review.photoUrls.map((src, i) => (
              <s-link key={src} href={src} target="_blank">
                <s-thumbnail src={src} alt={`Photo ${i + 1} from ${review.author}`} size="large" />
              </s-link>
            ))}
          </s-stack>
        ) : null}
        {review.reply ? (
          <s-box padding="small" background="subdued" borderRadius="base">
            <s-text type="strong">Your reply: </s-text>
            <s-text>{review.reply}</s-text>
          </s-box>
        ) : null}
        <s-stack direction="inline" gap="small">
          {review.status !== "published" ? (
            <s-button variant="primary" loading={busy} onClick={() => act("published")}>Publish</s-button>
          ) : null}
          {review.status !== "hidden" ? (
            <s-button loading={busy} onClick={() => act("hidden")}>Hide</s-button>
          ) : null}
          <s-button loading={busy} onClick={() => setReplying(!replying)}>
            {review.reply ? "Edit reply" : "Reply"}
          </s-button>
          <s-button tone="critical" variant="tertiary" loading={busy} onClick={() => act("delete")}>Delete</s-button>
        </s-stack>
        {replying ? (
          <s-stack gap="small">
            <s-text-area
              label="Public reply"
              details="Shown under the review on your store. Leave empty to remove."
              value={reply}
              rows={3}
              maxLength={1000}
              onInput={(e) => setReplyText(String(e.currentTarget.value))}
            />
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" loading={busy} onClick={() => { act("reply", { reply }); setReplying(false); }}>
                Save reply
              </s-button>
              <s-button variant="tertiary" onClick={() => setReplying(false)}>Cancel</s-button>
            </s-stack>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export default function Reviews() {
  const { status, reviews } = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  return (
    <s-page heading="Reviews">
      <s-section>
        <s-stack gap="small">
          <s-select
            label="Show"
            value={status}
            onInput={(e) => {
              const v = String(e.currentTarget.value);
              setParams(v === "all" ? {} : { status: v });
            }}
          >
            <s-option value="all">All reviews</s-option>
            <s-option value="pending">Waiting for approval</s-option>
            <s-option value="published">Published</s-option>
            <s-option value="hidden">Hidden</s-option>
          </s-select>
          <s-text color="subdued">
            Hide reviews only for abuse, spam, private information or reviews unrelated to the product — never because
            they're negative (FTC rule on consumer reviews).
          </s-text>
        </s-stack>
      </s-section>
      {reviews.length === 0 ? (
        <s-section>
          <s-empty-state heading="No reviews here yet">
            <s-paragraph>Reviews from your product pages and imports will appear here.</s-paragraph>
          </s-empty-state>
        </s-section>
      ) : (
        reviews.map((r) => <ReviewRow key={r.id} review={r} />)
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

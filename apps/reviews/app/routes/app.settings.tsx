import type { Route } from "./+types/app.settings";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { FormSaveBar, useSaveBar } from "@upwise/shopify-app/react";
import { getShopify } from "../shopify.server";
import { resolvePlan } from "../lib/admin.server";
import { getSettings, saveSettings } from "../lib/reviews.server";
import { recentRequests, sentThisMonth } from "../lib/requests.server";
import { PLAN_LIMITS } from "../lib/plans";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session, billing } = await getShopify(env).authenticate.admin(request);
  const db = getDb(env.DB);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  const limit = PLAN_LIMITS[plan].requestsPerMonth;
  return {
    settings: await getSettings(db, session.shop),
    requests: await recentRequests(db, session.shop, 20),
    sent: await sentThisMonth(db, session.shop),
    limit: Number.isFinite(limit) ? limit : null,
    hasOrderAccess: (session.scope ?? "").split(",").includes("read_orders"),
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const form = await request.formData();
  const delay = Math.round(Number(form.get("requestDelayDays")));
  await saveSettings(getDb(env.DB), session.shop, {
    autoPublish: form.get("autoPublish") !== "manual",
    requestsEnabled: form.get("requestsEnabled") === "on",
    requestDelayDays: Number.isFinite(delay) ? Math.min(60, Math.max(0, delay)) : 7,
  });
  return { ok: true };
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
  unsubscribed: "Opted out",
  limit: "Over monthly limit",
};

function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <s-stack gap="small">
      <s-button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            // App Bridge adds the session token to same-origin fetches.
            const res = await fetch("/app/export");
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `storevine-reviews-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          } catch {
            setError("The export didn't download. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Export all reviews (CSV)
      </s-button>
      {error ? <s-text tone="critical">{error}</s-text> : null}
    </s-stack>
  );
}

export default function Settings() {
  const { settings, requests, sent, limit, hasOrderAccess } = useLoaderData<typeof loader>();
  const saving = useNavigation().state === "submitting";
  const formRef = useRef<HTMLFormElement>(null);
  useSaveBar(formRef, "settings-save-bar", settings);
  return (
    <s-page heading="Settings">
      <FormSaveBar id="settings-save-bar" formRef={formRef} saving={saving} />
      <Form method="post" ref={formRef}>
        <s-section heading="New reviews">
          <s-choice-list label="When a customer submits a review" name="autoPublish" values={[settings.autoPublish ? "auto" : "manual"]}>
            <s-choice value="auto">Publish it right away</s-choice>
            <s-choice value="manual">Hold it for approval (check for spam or abuse before publishing)</s-choice>
          </s-choice-list>
        </s-section>
        <s-section heading="Review requests">
          <s-stack gap="base">
            <s-paragraph>
              Email each customer a short, neutral request after their order is fulfilled, with a link to review each product.
              Reviews written from these links are marked <s-text type="strong">Verified buyer</s-text>. Nothing is offered in
              exchange, and every rating is welcome, as the FTC rule on consumer reviews requires.
            </s-paragraph>
            {!hasOrderAccess ? (
              <s-banner tone="warning" heading="Order access needed">
                Reopen the app to approve the new order permission, then requests can start.
              </s-banner>
            ) : null}
            <s-switch label="Send review requests" name="requestsEnabled" checked={settings.requestsEnabled} />
            <s-number-field
              label="Days after fulfillment"
              name="requestDelayDays"
              value={String(settings.requestDelayDays)}
              min={0}
              max={60}
              step={1}
              details="Give customers time to receive and try the product. 7 days suits most stores."
            />
            <s-text color="subdued">
              Sent this month: {sent.toLocaleString()}
              {limit !== null ? ` of ${limit.toLocaleString()} on your plan` : ""}. Customers can opt out from any email.
            </s-text>
          </s-stack>
        </s-section>
      </Form>
      <s-section heading="Recent requests">
        {requests.length === 0 ? (
          <s-paragraph>No requests yet. They appear here once orders are fulfilled with requests turned on.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {requests.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.orderName || "–"}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.status === "sent" ? "success" : r.status === "failed" ? "critical" : r.status === "scheduled" ? "info" : undefined}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </s-badge>
                    {r.note && r.status !== "sent" ? <s-text color="subdued"> {r.note}</s-text> : null}
                  </s-table-cell>
                  <s-table-cell>{new Date(r.sentAt ?? r.sendAfter).toLocaleDateString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
      <s-section heading="Your data">
        <s-stack gap="small">
          <s-paragraph>Download every review, including status, verified flag and replies. Your reviews are always yours to take with you.</s-paragraph>
          <ExportButton />
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

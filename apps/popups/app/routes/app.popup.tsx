import type { Route } from "./+types/app.popup";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { FormSaveBar, useSaveBar } from "@upwise/shopify-app/react";
import { redirect } from "react-router";
import { getShopify } from "../shopify.server";
import { publishConfig, resolvePlan } from "../lib/admin.server";
import { getConfig, saveConfig, validateConfig, type PopupConfig } from "../lib/popup.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  return { config: await getConfig(getDb(env.DB), session.shop) };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { admin, session, billing } = await getShopify(env).authenticate.admin(request);
  const config = validateConfig(Object.fromEntries(await request.formData()));
  await saveConfig(getDb(env.DB), session.shop, config);
  const { plan } = await resolvePlan(billing as never, env, session.shop);
  await publishConfig(admin.graphql as never, env, session.shop, plan);
  return redirect("/app/popup?saved=1");
};

function Preview({ c }: { c: PopupConfig }) {
  return (
    <div style={{ background: "rgba(0,0,0,.45)", padding: 24, borderRadius: 12 }}>
      <div style={{ background: "#fff", color: "#111", borderRadius: 10, padding: 24, maxWidth: 360, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
        <p style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>{c.headline}</p>
        {c.body ? <p style={{ margin: "0 0 16px", fontSize: 14 }}>{c.body}</p> : null}
        <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "10px 12px", fontSize: 14, color: "#777", marginBottom: 8 }}>Email address</div>
        <div style={{ background: c.accentColor, color: "#fff", borderRadius: 6, padding: "10px 12px", textAlign: "center", fontWeight: 600, fontSize: 14 }}>{c.buttonLabel}</div>
        <p style={{ fontSize: 11, color: "#666", margin: "8px 0 0" }}>{c.consentText}</p>
      </div>
    </div>
  );
}

export default function PopupEditor() {
  const { config } = useLoaderData<typeof loader>();
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();
  const [params] = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<PopupConfig>(config);
  const [trigger, setTrigger] = useState(config.trigger);
  useSaveBar(formRef, "popup-save-bar", config);
  useEffect(() => setDraft(config), [config]);
  useEffect(() => {
    if (params.get("saved")) shopify.toast.show("Pop-up saved");
  }, [params, shopify]);

  const onInput = () => {
    const f = formRef.current;
    if (!f) return;
    const v = Object.fromEntries(new FormData(f));
    setDraft((d) => ({ ...d, headline: String(v.headline ?? d.headline), body: String(v.body ?? ""), buttonLabel: String(v.buttonLabel ?? d.buttonLabel), consentText: String(v.consentText ?? d.consentText), accentColor: String(v.accentColor ?? d.accentColor) }));
    setTrigger((String(v.trigger ?? "delay") as PopupConfig["trigger"]));
  };

  return (
    <s-page heading="Pop-up">
      <FormSaveBar id="popup-save-bar" formRef={formRef} saving={saving} />
      <Form method="post" ref={formRef} onInput={onInput} onChange={onInput}>
        <s-section heading="Status">
          <s-switch label="Show the pop-up on my store" name="enabled" checked={config.enabled} details="Also turn on the Storevine Pop-ups app embed in your theme." />
        </s-section>
        <s-section heading="Content">
          <s-stack gap="base">
            <s-text-field label="Headline" name="headline" value={config.headline} maxLength={80} />
            <s-text-area label="Message" name="body" value={config.body} maxLength={240} rows={2} />
            <s-text-field label="Button label" name="buttonLabel" value={config.buttonLabel} maxLength={30} />
            <s-text-field label="Message after signing up" name="successMessage" value={config.successMessage} maxLength={160} />
            <s-text-field label="Discount code to show after signing up (optional)" name="discountCode" value={config.discountCode} maxLength={40} details="Create the code in Shopify Discounts first." />
            <s-text-area label="Consent text" name="consentText" value={config.consentText} maxLength={240} rows={2} details="Tell people they're agreeing to marketing emails." />
            <s-color-field label="Button color" name="accentColor" value={config.accentColor} />
          </s-stack>
        </s-section>
        <s-section heading="When to show it">
          <s-stack gap="base">
            <s-select label="Trigger" name="trigger" value={config.trigger}>
              <s-option value="delay">After a delay</s-option>
              <s-option value="exit">When the visitor is about to leave (desktop)</s-option>
              <s-option value="scroll">After scrolling part of the page</s-option>
            </s-select>
            {trigger === "delay" ? <s-number-field label="Delay" name="delaySeconds" value={String(config.delaySeconds)} min={0} max={120} suffix="seconds" /> : <input type="hidden" name="delaySeconds" value={config.delaySeconds} />}
            {trigger === "scroll" ? <s-number-field label="Scroll depth" name="scrollPercent" value={String(config.scrollPercent)} min={10} max={100} suffix="%" /> : <input type="hidden" name="scrollPercent" value={config.scrollPercent} />}
            <s-number-field label="Don't show again for" name="frequencyDays" value={String(config.frequencyDays)} min={0} max={365} suffix="days" details="After someone closes or signs up. 0 = every visit." />
            <s-select label="Pages" name="pages" value={config.pages}>
              <s-option value="all">All pages</s-option>
              <s-option value="home">Home page only</s-option>
            </s-select>
          </s-stack>
        </s-section>
      </Form>
      <s-section slot="aside" heading="Preview">
        <Preview c={draft} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

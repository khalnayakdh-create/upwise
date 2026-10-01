import type { Route } from "./+types/app.settings";
import type { HeadersFunction } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { useRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getDb } from "@upwise/platform";
import { FormSaveBar, useSaveBar } from "@upwise/shopify-app/react";
import { getShopify } from "../shopify.server";
import { getSettings, saveSettings } from "../lib/reviews.server";

export const loader = async ({ request, context }: Route.LoaderArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  return { settings: await getSettings(getDb(env.DB), session.shop) };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  const { env } = context.cloudflare;
  const { session } = await getShopify(env).authenticate.admin(request);
  const form = await request.formData();
  await saveSettings(getDb(env.DB), session.shop, { autoPublish: form.get("autoPublish") !== "manual" });
  return { ok: true };
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
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
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

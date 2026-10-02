import { useCallback, useEffect, useRef, type RefObject } from "react";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";

function serialize(form: HTMLFormElement | null) {
  if (!form) return "";
  const entries: Array<[string, string]> = [];
  new FormData(form).forEach((value, key) => {
    if (key !== "intent") entries.push([key, String(value)]);
  });
  return JSON.stringify(entries);
}

/**
 * Contextual save bar with explicit dirty tracking (BFS requirement).
 * Compares the form's current values with the last saved values; the baseline
 * resets whenever `savedKey` changes (pass the loader data).
 */
export function useSaveBar(formRef: RefObject<HTMLFormElement | null>, id: string, savedKey: unknown) {
  const shopify = useAppBridge();
  const baseline = useRef("");
  const key = JSON.stringify(savedKey);

  // False once the form unmounts (e.g. redirect after save), so a check queued
  // just before navigation can't re-show the bar on the next page.
  const mounted = useRef(true);

  const check = useCallback(() => {
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!mounted.current || !form) return;
      if (serialize(form) !== baseline.current) shopify.saveBar.show(id);
      else shopify.saveBar.hide(id);
    });
  }, [formRef, id, shopify]);

  // New saved data (first load or after save): this is the clean state.
  useEffect(() => {
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      baseline.current = serialize(formRef.current);
      shopify.saveBar.hide(id);
    });
  }, [key, formRef, id, shopify]);

  useEffect(() => {
    mounted.current = true;
    const form = formRef.current;
    if (!form) return;
    // Hide as soon as the form is submitted: on success the route redirects and
    // the <SaveBar> element is removed before an unmount-time hide can reach it,
    // which left "Unsaved changes" showing on the next page. If the save fails,
    // the next edit re-runs the check and shows the bar again.
    const onSubmit = () => shopify.saveBar.hide(id);
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    form.addEventListener("submit", onSubmit);
    return () => {
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
      form.removeEventListener("submit", onSubmit);
      mounted.current = false;
      shopify.saveBar.hide(id);
    };
  }, [formRef, check, id, shopify]);

  return check;
}

export function FormSaveBar({ id, formRef, saving }: { id: string; formRef: RefObject<HTMLFormElement | null>; saving: boolean }) {
  return (
    <SaveBar id={id}>
      <button variant="primary" loading={saving ? "" : undefined} onClick={() => formRef.current?.requestSubmit()} />
      <button onClick={() => window.location.reload()} />
    </SaveBar>
  );
}

const DEFAULT_HEALTH_CAUSES =
  "Common causes: the app block or embed was removed or turned off in a theme change, the theme was switched, or the products in it went out of stock.";

/** Dashboard banner for problems found by the daily health check (see runAppHealthCheck). */
export function HealthBanner({ problems, causes = DEFAULT_HEALTH_CAUSES }: { problems: Array<{ key: string; problem: string; since: string }>; causes?: string }) {
  if (!problems.length) return null;
  return (
    <s-banner tone="warning" heading="Something needs a look">
      <s-stack gap="small">
        {problems.map((p) => (
          <s-paragraph key={p.key}>{p.problem}</s-paragraph>
        ))}
        <s-paragraph>{causes} This clears after the next daily check once things are back to normal.</s-paragraph>
      </s-stack>
    </s-banner>
  );
}

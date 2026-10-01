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

  const check = useCallback(() => {
    requestAnimationFrame(() => {
      if (serialize(formRef.current) !== baseline.current) shopify.saveBar.show(id);
      else shopify.saveBar.hide(id);
    });
  }, [formRef, id, shopify]);

  // New saved data (first load or after save): this is the clean state.
  useEffect(() => {
    requestAnimationFrame(() => {
      baseline.current = serialize(formRef.current);
      shopify.saveBar.hide(id);
    });
  }, [key, formRef, id, shopify]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    return () => {
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
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

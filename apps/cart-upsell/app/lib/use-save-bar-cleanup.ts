import { useLayoutEffect, type RefObject } from "react";

/**
 * App Bridge shows the contextual save bar for <form data-save-bar> when it
 * changes and hides it on submit/reset. React Router navigates away after a
 * successful save, removing the form while the bar is still "dirty". Dispatch
 * a reset right before unmount so the bar doesn't linger on the next page.
 */
export function useSaveBarCleanup(formRef: RefObject<HTMLFormElement | null>) {
  useLayoutEffect(() => {
    const form = formRef.current;
    return () => {
      form?.dispatchEvent(new Event("reset", { bubbles: true }));
    };
  }, [formRef]);
}

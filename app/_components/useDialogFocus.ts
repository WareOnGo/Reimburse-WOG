"use client";

import { useEffect, useRef } from "react";

/** Keep keyboard navigation inside an open modal, then restore its trigger. */
export function useDialogFocus(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const trigger = document.activeElement;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )).filter((element) => !element.closest('[hidden], [aria-hidden="true"]'));
    (controls()[0] ?? dialog).focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog!.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog!.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

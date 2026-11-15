"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover, menu or sheet: on Escape, and (when a ref is given) on a
 * press outside that element. Listens only while `open` is true.
 */
export function useDismiss(open: boolean, onClose: () => void, ref?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref?.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, ref]);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyErrorMessage } from "@domain/platform/errors";
import { shortDay } from "@domain/platform/dates";
import { wholeNumber } from "@domain/platform/numbers";

// Markup and class constants live in ./primitives (no client code); this file adds the data hook and keeps
// every older import from "@/components/ui/kit" working.
export * from "./primitives";
export { shortDay, wholeNumber };

export function messageFromUnknown(error: unknown) {
  return friendlyErrorMessage(error);
}

/** Loads page data on mount, when key changes, and on reload(). */
export function useLoaded<T>(load: () => Promise<T>, initial: T, key = "") {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRef
      .current()
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setError("");
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(messageFromUnknown(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version, key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data, loading, error, reload };
}


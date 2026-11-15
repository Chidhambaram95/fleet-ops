"use client";

import { friendlyErrorMessage } from "@domain/platform/errors";

/** A page failed to load. The menu and header stay; the person can retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-3xl bg-white px-4 py-6">
      <h1 className="text-lg font-extrabold">This page could not be opened</h1>
      <p className="text-muted">{friendlyErrorMessage(error)}</p>
      <button
        type="button"
        onClick={reset}
        className="h-12 self-start rounded-2xl bg-brand px-5 text-[15px] font-bold text-white"
      >
        Try again
      </button>
    </div>
  );
}

/** Shown while a page's server data loads, so a tap on a menu item answers straight away. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-xl bg-white" />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-3xl bg-white" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-3xl bg-white" />
    </div>
  );
}

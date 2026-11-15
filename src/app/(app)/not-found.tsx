import Link from "next/link";

/** An address that does not exist, or a screen this bus type does not have. */
export default function AppNotFound() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-6">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-muted">That page does not exist, or it is not part of this bus type.</p>
      <Link href="/" className="self-start text-sm font-semibold text-brand">
        Go to Home
      </Link>
    </div>
  );
}

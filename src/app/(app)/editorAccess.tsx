import Link from "next/link";

export function AccessMessage({ message, link }: { message: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-6">
      <p className="text-muted">{message}</p>
      {link ? (
        <Link href={link.href} className="self-start text-sm font-semibold text-brand">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

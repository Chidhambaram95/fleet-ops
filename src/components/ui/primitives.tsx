import Link from "next/link";
import type { ReactNode } from "react";

/** Shared building blocks for the money, renewals and report pages. */
export const FIELD =
  "h-12 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-faint focus:border-brand disabled:bg-subtle disabled:text-muted lg:h-10 lg:text-sm";
export const LABEL = "flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ink";
export const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50 lg:h-10";
export const SECONDARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50 lg:h-10";

export function PageHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink lg:text-2xl">{title}</h1>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 lg:p-5">
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-base font-semibold text-ink">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-6 overflow-x-auto border-b border-line">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
          className={`-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 text-sm ${
            value === option.id
              ? "border-brand font-semibold text-ink"
              : "border-transparent font-medium text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export function ErrorText({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="text-sm font-semibold text-money-out">
      {message}
    </p>
  ) : null;
}

/** A row in a white list: main text on the left, amount and actions on the right. */
export function ListRow({
  title,
  detail,
  amount,
  tone = "ink",
  actions,
  first,
}: {
  title: ReactNode;
  detail?: ReactNode;
  amount?: ReactNode;
  tone?: "in" | "out" | "ink";
  actions?: ReactNode;
  first?: boolean;
}) {
  const toneClass =
    tone === "in" ? "text-money-in" : tone === "out" ? "text-money-out" : "text-ink";
  return (
    <div
      className={`flex items-center justify-between gap-3 py-3 ${
        first ? "" : "border-t border-line"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{title}</p>
        {detail ? <p className="truncate text-xs text-muted">{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {amount != null ? <span className={`text-sm font-semibold tabular-nums ${toneClass}`}>{amount}</span> : null}
        {actions}
      </div>
    </div>
  );
}

export function SmallButton({
  onClick,
  children,
  tone = "muted",
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  tone?: "muted" | "brand";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2 text-sm font-semibold disabled:opacity-40 ${
        tone === "brand" ? "text-brand" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function BusSelect({
  buses,
  value,
  onChange,
  allLabel,
}: {
  buses: { id: string; registrationNumber: string }[];
  value: string;
  onChange: (next: string) => void;
  allLabel: string;
}) {
  return (
    <select className={FIELD} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{allLabel}</option>
      {buses.map((bus) => (
        <option key={bus.id} value={bus.id}>
          {bus.registrationNumber}
        </option>
      ))}
    </select>
  );
}

/** A figure with a label, as a tile. Pass `href` to make the whole tile a link. */
export function KpiTile({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "in" | "out";
  href?: string;
}) {
  const body = (
    <>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span
        className={`text-2xl font-semibold tracking-tight tabular-nums ${
          tone === "in" ? "text-money-in" : tone === "out" ? "text-money-out" : "text-ink"
        }`}
      >
        {value}
      </span>
      {detail ? <span className="text-xs text-muted">{detail}</span> : null}
    </>
  );
  const base = "flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-4";
  return href ? (
    <Link href={href} className={`${base} hover:border-line-strong`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

/** Small status label. Always carries text, so colour is never the only signal. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const colours = {
    neutral: "bg-subtle text-muted",
    ok: "bg-success-bg text-money-in",
    warn: "bg-warn-bg text-warn-ink",
    danger: "bg-danger-bg text-money-out",
  }[tone];
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium ${colours}`}>
      {children}
    </span>
  );
}

import type { ReactNode } from "react";

/** Shared theme C building blocks for the money, renewals and report pages. */
export const FIELD =
  "h-12 w-full min-w-0 rounded-2xl bg-canvas px-4 text-base disabled:opacity-70";
export const LABEL = "flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold";
export const PRIMARY =
  "h-12 rounded-2xl bg-brand px-5 text-[15px] font-bold text-white disabled:opacity-50";
export const SECONDARY =
  "h-12 rounded-2xl bg-canvas px-5 text-[15px] font-bold text-brand disabled:opacity-50";

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
        <h1 className="text-2xl font-extrabold">{title}</h1>
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
    <section className="flex min-w-0 flex-col gap-3 rounded-3xl bg-white p-4 md:p-5">
      {title || action ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="font-extrabold">{title}</h2> : <span />}
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
    <div className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`h-11 shrink-0 grow rounded-full px-4 text-sm font-bold ${
            value === option.id ? "bg-brand text-white" : "text-muted"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-3xl bg-white px-4 py-6 text-center text-muted">{children}</p>;
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
        <p className="truncate font-semibold">{title}</p>
        {detail ? <p className="truncate text-xs text-muted">{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {amount != null ? <span className={`font-bold ${toneClass}`}>{amount}</span> : null}
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
      className={`px-2 text-[13px] font-semibold disabled:opacity-40 ${
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

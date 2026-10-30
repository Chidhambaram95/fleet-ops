import type { BusStatus, MileagePoint } from "@domain/mileage/mileage";

/** Colours of each status, the same on every mileage screen. */
export const STATUS_COLOURS: Record<BusStatus, string> = {
  alert: "#a3321c",
  warn: "#c27a00",
  ok: "#3a3fb8",
  none: "#c5c7dc",
};

export const STATUS_LABELS: Record<BusStatus, string> = {
  alert: "Alert",
  warn: "Check",
  ok: "Normal",
  none: "No data",
};

export const STATUS_PILLS: Record<BusStatus, string> = {
  alert: "bg-[#fbe9e5] text-money-out",
  warn: "bg-warn-bg text-warn-ink",
  ok: "bg-brand-soft text-brand-dark",
  none: "bg-canvas text-muted",
};

/** Round chart of buses by status, with "3/5 normal" in the middle. */
export function StatusDonut({ counts, size = 140 }: { counts: Record<BusStatus, number>; size?: number }) {
  const total = counts.ok + counts.warn + counts.alert;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = (["ok", "warn", "alert"] as const).map((status) => {
    const length = total ? (counts[status] / total) * circumference : 0;
    const segment = { status, length, offset };
    offset += length;
    return segment;
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      role="img"
      aria-label={`${counts.ok} of ${total} buses normal, ${counts.warn} to check, ${counts.alert} alert`}
      className="shrink-0"
    >
      <circle cx="80" cy="80" r={radius} fill="none" stroke="#eeeff7" strokeWidth="22" />
      {segments.map((segment) =>
        segment.length > 0 ? (
          <circle
            key={segment.status}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={STATUS_COLOURS[segment.status]}
            strokeWidth="22"
            strokeDasharray={`${segment.length} ${circumference - segment.length}`}
            strokeDashoffset={-segment.offset}
            transform="rotate(-90 80 80)"
          />
        ) : null,
      )}
      <text x="80" y="86" textAnchor="middle" fontSize="34" fontWeight="800" fill="#1a1b2e">
        {counts.ok}/{total}
      </text>
      <text x="80" y="108" textAnchor="middle" fontSize="14" fill="#5b5e7a">
        normal
      </text>
    </svg>
  );
}

/** A ring that fills to the latest km/L as a share of the usual, with the km/L inside. */
export function KmplRing({
  kmpl,
  usual,
  status,
  size = 56,
}: {
  kmpl: number | null;
  usual: number | null;
  status: BusStatus;
  size?: number;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const share = kmpl != null && usual ? Math.min(kmpl / usual, 1) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 84 84" aria-hidden="true" className="shrink-0">
      <circle cx="42" cy="42" r={radius} fill="none" stroke="#eeeff7" strokeWidth="10" />
      {share > 0 ? (
        <circle
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          stroke={STATUS_COLOURS[status]}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform="rotate(-90 42 42)"
        />
      ) : null}
      <text x="42" y="49" textAnchor="middle" fontSize="22" fontWeight="800" fill="#1a1b2e">
        {kmpl != null ? kmpl.toFixed(1) : "–"}
      </text>
    </svg>
  );
}

function circlePath(x: number, y: number, r: number) {
  return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
}

/** Km per litre point by point, with the bus's normal range shaded and flagged points coloured. */
export function TripChart({
  recent,
  usual,
  colour,
  label,
}: {
  recent: { point: MileagePoint; flagged: boolean }[];
  usual: number | null;
  colour: string;
  label: string;
}) {
  const width = 520;
  const height = 140;
  const bottom = 24;
  const values = recent.map((item) => item.point.kmpl);
  const low = Math.floor(Math.min(...values, usual ? usual * 0.8 : Infinity) * 2) / 2;
  const high = Math.ceil(Math.max(...values, usual ? usual * 1.2 : -Infinity) * 2) / 2;
  const span = high - low || 1;
  const x = (index: number) => (recent.length === 1 ? width / 2 : 8 + (index * (width - 16)) / (recent.length - 1));
  const y = (value: number) => 8 + ((high - value) / span) * (height - 8 - bottom);
  const line = recent.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(item.point.kmpl).toFixed(1)}`).join(" ");
  const plain = recent
    .map((item, index) => (item.flagged ? "" : circlePath(x(index), y(item.point.kmpl), 4)))
    .join("");
  const flagged = recent
    .map((item, index) => (item.flagged ? circlePath(x(index), y(item.point.kmpl), 5.5) : ""))
    .join("");
  const bandTop = usual ? y(Math.min(usual * 1.15, high)) : 0;
  const bandBottom = usual ? y(Math.max(usual * 0.85, low)) : 0;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={label} className="block">
      {usual ? (
        <>
          <rect x="0" y={bandTop} width={width} height={Math.max(bandBottom - bandTop, 0)} rx="6" fill="#e6e7fa" />
          <line x1="0" x2={width} y1={y(usual)} y2={y(usual)} stroke="#3a3fb8" strokeWidth="1.5" strokeDasharray="6 5" />
        </>
      ) : null}
      <path d={line} fill="none" stroke="#3a3fb8" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <path d={plain} fill="#ffffff" stroke="#3a3fb8" strokeWidth="2" />
      <path d={flagged} fill={colour} stroke="#ffffff" strokeWidth="2" />
      <text x="0" y={height - 4} fontSize="12" fill="#5b5e7a">
        {recent.length > 1 ? `${recent.length} ${recent[0].point.tripId ? "trips" : "fills"} ago` : ""}
      </text>
      <text x={width} y={height - 4} textAnchor="end" fontSize="12" fill="#5b5e7a">
        Latest
      </text>
    </svg>
  );
}

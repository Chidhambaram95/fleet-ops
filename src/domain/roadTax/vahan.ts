/**
 * Paying quarterly road tax (MV tax) on Vahan, Tamil Nadu.
 *
 * Fleet Ops does not pay. It works out which quarter is due, hands the bus
 * details to the Fleet Ops Vahan helper (a Chrome extension) which fills Vahan
 * in and stops before "Confirm Payment", or, on a phone, shows the details to
 * copy. Dates inside Fleet Ops are YYYY-MM-DD; Vahan shows DD-MM-YYYY.
 */

export const VAHAN_HOME_URL = "https://vahan.parivahan.gov.in/vahanservice/";
/** The part of the link after "#" that carries the job to the helper. Never sent to Vahan's server. */
export const VAHAN_JOB_KEY = "fleetops";
export const VAHAN_JOB_VERSION = 1;

export type TaxQuarter = {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day, YYYY-MM-DD. */
  to: string;
  /** e.g. "Oct – Dec 2026". */
  label: string;
};

/** What the helper needs to fill Vahan in and check it. */
export type VahanJob = {
  v: typeof VAHAN_JOB_VERSION;
  /** Registration number as saved in Fleet Ops, e.g. "TN 45 AB 1234". */
  reg: string;
  chassisLast5: string;
  ownerName: string;
  /** The quarter picked in Fleet Ops, DD-MM-YYYY as Vahan shows it. */
  from: string;
  to: string;
  /** Last road tax paid for this bus, for a "this looks unusual" hint. */
  lastAmountInr: number | null;
  /** When Start was pressed, ms since 1970. The helper ignores old jobs. */
  createdAt: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "TN 45 ab-1234" → "TN45AB1234", for comparing with what Vahan shows. */
export function normalizeRegistration(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "s. kumar " → "S KUMAR", for comparing owner names; dots, commas and extra spaces do not count. */
export function normalizeOwnerName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Upper case, letters and digits only. Valid when exactly 5 are left. */
export function normalizeChassisLast5(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidChassisLast5(value: string): boolean {
  return /^[A-Z0-9]{5}$/.test(value);
}

function parts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parts(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** The calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec) the date falls in. */
export function quarterContaining(date: string): TaxQuarter {
  const [year, month] = parts(date);
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  const last = first + 2;
  const lastDay = new Date(Date.UTC(year, last, 0)).getUTCDate();
  return {
    from: iso(year, first, 1),
    to: iso(year, last, lastDay),
    label: `${MONTHS[first - 1]} – ${MONTHS[last - 1]} ${year}`,
  };
}

/**
 * The quarters to offer, the next due one first. Tax is due from the day after
 * the last road tax "valid till" date; with no road tax saved, from the quarter
 * we are in. If the last payment ended mid-quarter, the first option runs from
 * the day after to the end of that quarter.
 */
export function taxQuarterOptions(paidTill: string | null, today: string, count = 4): TaxQuarter[] {
  const start = paidTill ? addDays(paidTill, 1) : quarterContaining(today).from;
  const options: TaxQuarter[] = [];
  let quarter = quarterContaining(start);
  options.push({ ...quarter, from: start });
  while (options.length < count) {
    quarter = quarterContaining(addDays(quarter.to, 1));
    options.push(quarter);
  }
  return options;
}

/** "2026-10-01" → "01-10-2026", as Vahan shows dates. */
export function toVahanDate(date: string): string {
  const [year, month, day] = parts(date);
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

/** "01-10-2026" → "2026-10-01". */
export function fromVahanDate(date: string): string {
  const [day, month, year] = date.trim().split("-").map(Number);
  return iso(year, month, day);
}

/** What is missing before the helper can start, in the words shown to the user. */
export function missingForVahan(bus: { chassisLast5: string; ownerName: string }): string[] {
  const missing: string[] = [];
  if (!isValidChassisLast5(bus.chassisLast5)) missing.push("chassis last 5");
  if (!normalizeOwnerName(bus.ownerName)) missing.push("owner name");
  return missing;
}

export function buildVahanJob(input: {
  registrationNumber: string;
  chassisLast5: string;
  ownerName: string;
  quarter: TaxQuarter;
  lastAmountInr: number | null;
  now?: number;
}): VahanJob {
  return {
    v: VAHAN_JOB_VERSION,
    reg: input.registrationNumber.trim(),
    chassisLast5: normalizeChassisLast5(input.chassisLast5),
    ownerName: normalizeOwnerName(input.ownerName),
    from: toVahanDate(input.quarter.from),
    to: toVahanDate(input.quarter.to),
    lastAmountInr: input.lastAmountInr,
    createdAt: input.now ?? Date.now(),
  };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The Vahan link that hands the job to the helper. The job sits after "#", so it never reaches Vahan's server. */
export function vahanStartUrl(job: VahanJob): string {
  return `${VAHAN_HOME_URL}#${VAHAN_JOB_KEY}=${toBase64Url(JSON.stringify(job))}`;
}

/** Reads a job back from a link's "#" part; null when it is not one. */
export function readVahanJob(hash: string): VahanJob | null {
  const match = new RegExp(`(?:^#?|&)${VAHAN_JOB_KEY}=([A-Za-z0-9_-]+)`).exec(hash);
  if (!match) return null;
  try {
    const job = JSON.parse(fromBase64Url(match[1])) as VahanJob;
    return job && job.v === VAHAN_JOB_VERSION ? job : null;
  } catch {
    return null;
  }
}

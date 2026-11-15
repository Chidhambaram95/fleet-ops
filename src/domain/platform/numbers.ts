/** Number from text typed with spaces or commas ("1,20,560"); NaN when it is not a number. */
export function parseTypedNumber(value: string): number {
  return Number(value.replace(/[\s,]/g, ""));
}

/** Whole rupees from text such as "₹1,200"; null when it is not a plain number. */
export function wholeNumber(value: string): number | null {
  const cleaned = value.replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned));
}

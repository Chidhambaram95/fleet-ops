/** Whole rupees in the Indian grouping, for example ₹1,23,456. A negative amount gets a minus sign. */
export function formatInr(amount: number): string {
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));

  return amount < 0 ? `−${formatted}` : formatted;
}

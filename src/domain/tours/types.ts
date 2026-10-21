export type TourStatus = "enquiry" | "quoted" | "confirmed" | "completed" | "cancelled";
export type PayMode = "cash" | "upi" | "bank";

export const PAY_MODES: { id: PayMode; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "bank", label: "Bank" },
];

/** One customer enquiry, which becomes a quote, a booking and then a finished tour. */
export type TourBooking = {
  id: string;
  quoteNo: number;
  status: TourStatus;
  customerName: string;
  customerPhone: string;
  pickup: string;
  dropPlace: string;
  seatsNeeded: number | null;
  /** IST calendar days, YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Exact times; empty means the booking counts as whole days. */
  startAt: string | null;
  endAt: string | null;
  busId: string | null;
  hireAmountInr: number;
  advanceRequiredInr: number;
  inclusions: string;
  quoteValidUntil: string | null;
  quoteSentAt: string | null;
  tripId: string | null;
  note: string;
  cancelledReason: string;
  createdAt: string;
};

export type TourPayment = {
  id: string;
  bookingId: string;
  receivedOn: string;
  amountInr: number;
  mode: PayMode;
  note: string;
};

export type TourSettings = {
  quoteValidDays: number;
  advancePercent: number;
  turnaroundHours: number;
};

export const DEFAULT_TOUR_SETTINGS: TourSettings = {
  quoteValidDays: 3,
  advancePercent: 25,
  turnaroundHours: 3,
};

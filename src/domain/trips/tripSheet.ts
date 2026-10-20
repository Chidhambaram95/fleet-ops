import { z } from "zod";
import { TRIP_EXPENSE_IDS } from "./catalog";

/** What the photo reader returns for one trip sheet. Numbers are as written. */
export const tripSheetSchema = z.object({
  sheetNo: z.string().nullish(),
  busNumber: z.string().nullish(),
  route: z.string().nullish(),
  startDate: z.string().nullish().describe("YYYY-MM-DD"),
  startTime: z.string().nullish().describe("24-hour HH:MM"),
  endDate: z.string().nullish().describe("YYYY-MM-DD"),
  endTime: z.string().nullish().describe("24-hour HH:MM"),
  haltNote: z.string().nullish(),
  driver1: z.string().nullish(),
  driver2: z.string().nullish(),
  cleaner: z.string().nullish(),
  startKm: z.number().nullish(),
  endKm: z.number().nullish(),
  advance: z.number().nullish(),
  writtenTotal: z.number().nullish(),
  dieselFills: z
    .array(
      z.object({
        litres: z.number().nullish(),
        amount: z.number(),
        paidBy: z.enum(["cash", "credit"]).nullish(),
        pump: z.string().nullish(),
      }),
    )
    .default([]),
  expenses: z
    .array(
      z.object({
        category: z.enum(TRIP_EXPENSE_IDS),
        amount: z.number(),
        note: z.string().nullish(),
      }),
    )
    .default([]),
});

export type TripSheetReading = z.infer<typeof tripSheetSchema>;

export const tripSheetPrompt = [
  "This is a photo of a handwritten trip sheet from a Tamil Nadu bus operator.",
  "Labels may be printed in Tamil, English or both. Handwriting can run outside the printed lines, and some numbers are written over earlier ones: always take the final, clearest value.",
  "Return values exactly as written. Do not add up, correct or guess numbers; leave a field null when it is blank or unreadable.",
  "busNumber is the vehicle registration, for example TN 48 CY 2555.",
  "Dates are usually written day first (DD/MM/YY); return them as YYYY-MM-DD. Times as 24-hour HH:MM.",
  "haltNote is any halt or stay dates written on the sheet.",
  "driver1, driver2 and cleaner are names (ஓட்டுநர் = driver, கிளீனர் = cleaner).",
  "startKm and endKm are the odometer readings at the start and end.",
  "advance is the cash advance given to the driver (அட்வான்ஸ்).",
  "writtenTotal is the total of expenses written on the sheet (மொத்தம்), if any.",
  "dieselFills: one entry per diesel fill with litres, amount, paidBy (credit when marked credit or கடன், else cash) and the pump name.",
  "expenses: one entry per cash expense line. category is one of: pooja (பூஜை), driver_bata (டிரைவர் பேட்டா), cleaner_bata (கிளீனர் பேட்டா), toll (டோல்), halt_bata (ஹால்ட் பேட்டா), rto (RTO), adblue (AdBlue), police (PC or போலீஸ்), parking (பார்க்கிங்), tyre (டயர்), mechanic (மெக்கானிக்), seat_wash (seat cover wash), grease (கிரீஸ்), other. Put anything else in other with its label as note. Do not put diesel in expenses.",
].join(" ");

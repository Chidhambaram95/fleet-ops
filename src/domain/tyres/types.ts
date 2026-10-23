export type TyreStatus = "in_stock" | "fitted" | "at_retreader" | "scrapped";

export type TyreEventKind =
  | "fitted"
  | "rotated"
  | "removed"
  | "sent_for_retread"
  | "retread_received"
  | "repair"
  | "scrapped";

/**
 * One tyre. The tyre number never changes, through every retread. Status,
 * bus, position, km, retreads and uncharged money are worked out from the
 * events by the database.
 */
export type Tyre = {
  id: string;
  tyreNumber: string;
  brand: string;
  size: string;
  boughtAs: "new" | "retreaded";
  purchaseDate: string;
  purchasePriceInr: number | null;
  vendor: string;
  billPhotoPath: string;
  warrantyMonths: number | null;
  warrantyKm: number | null;
  warrantyNote: string;
  note: string;
  status: TyreStatus;
  currentBusId: string | null;
  currentPosition: string | null;
  fittedOdometerKm: number | null;
  retreadCount: number;
  /** Km over finished stints; the current stint is added on screen when an odometer is known. */
  totalKm: number;
  /** Purchase, retread and off-bus repair money waiting for the next bus. */
  unchargedInr: number;
};

export type NewTyre = Pick<
  Tyre,
  | "tyreNumber"
  | "brand"
  | "size"
  | "boughtAs"
  | "purchaseDate"
  | "purchasePriceInr"
  | "vendor"
  | "billPhotoPath"
  | "warrantyMonths"
  | "warrantyKm"
  | "warrantyNote"
  | "note"
>;

export type TyreEvent = {
  id: string;
  seq: number;
  tyreId: string;
  kind: TyreEventKind;
  eventDate: string;
  busId: string | null;
  busLabel: string;
  position: string | null;
  /** Rotated: the position it moved from on the same bus. */
  fromPosition: string | null;
  odometerKm: number | null;
  kmRun: number | null;
  costInr: number | null;
  /** What the bus on this event pays, on its date. */
  chargeInr: number;
  vendor: string;
  reason: string;
  note: string;
};

export type TyreMove = {
  kind: TyreEventKind;
  date: string;
  busId?: string | null;
  position?: string | null;
  odometerKm?: number | null;
  costInr?: number | null;
  vendor?: string;
  reason?: string;
  note?: string;
};

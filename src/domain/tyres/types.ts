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
  /** Km in the current life (since bought or last retread) over finished stints. */
  lifeKm: number;
  /** Warranty km for the current life, when one was given. */
  lifeLimitKm: number | null;
  /** Off the bus and waiting to be sold as scrap, since this day. */
  scrapPileOn: string | null;
  /** With the dealer on a pending warranty claim, since this day. */
  warrantyClaimOn: string | null;
};

/** Company defaults for how long a tyre should last, per life. */
export type TyreLifeSettings = { newLifeKm: number; retreadLifeKm: number };

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
  /** Back from retread: the retreader's warranty. */
  warrantyKm: number | null;
  warrantyMonths: number | null;
  /** Scrapped as part of this scrap sale. */
  scrapSaleId: string | null;
  /** Scrapped when this warranty claim was settled. */
  warrantyClaimId: string | null;
};

export type TyreClaimStatus = "pending" | "replaced" | "credited" | "rejected" | "cancelled";

/** A warranty claim with the dealer and how it ended. */
export type TyreClaim = {
  id: string;
  tyreId: string;
  raisedOn: string;
  dealer: string;
  reason: string;
  note: string;
  kmAtClaim: number;
  lifeKmAtClaim: number;
  status: TyreClaimStatus;
  closedOn: string | null;
  outcomeNote: string;
  /** Credited: the money, which goes back to the bus that paid for this life of the tyre. */
  creditInr: number | null;
  creditBusId: string | null;
  creditBusLabel: string;
  /** Replaced: the new tyre and the top-up paid for it. */
  replacementTyreId: string | null;
  topUpInr: number | null;
};

export type ScrapReceivedVia = "cash" | "account";

/** Tyres sold together as scrap; the money is company income. */
export type TyreScrapSale = {
  id: string;
  soldOn: string;
  buyer: string;
  amountInr: number;
  receivedVia: ScrapReceivedVia;
  tyreCount: number;
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
  /** Back from retread: the retreader's warranty. */
  warrantyKm?: number | null;
  warrantyMonths?: number | null;
};

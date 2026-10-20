export type RenewalKind =
  | "fc"
  | "insurance"
  | "permit"
  | "road_tax"
  | "puc"
  | "speed_governor"
  | "gps"
  | "licence"
  | "badge";

/** One renewal of one document. The newest expiry for a bus or driver and kind is current. */
export type Renewal = {
  id: string;
  busId: string | null;
  personId: string | null;
  kind: RenewalKind;
  permitType: string;
  expiresOn: string;
  amountInr: number | null;
  paidOn: string | null;
  photoPath: string;
  note: string;
};

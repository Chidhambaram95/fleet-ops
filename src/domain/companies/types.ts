import type { PaymentDetails, Subscription } from "@domain/billing/subscription";

export const BUS_TYPES = ["town", "omni", "tour"] as const;
export type BusType = (typeof BUS_TYPES)[number];

export const BUS_TYPE_LABELS: Record<BusType, string> = {
  town: "Town bus",
  omni: "Omni bus",
  tour: "Tour bus",
};

export type CompanyProfile = {
  name: string;
  town: string;
  gstin: string;
  whatsappNumber: string;
  busTypes: BusType[];
  subscription: Subscription | null;
  paymentDetails: PaymentDetails | null;
};

export type Company = {
  organizationId: string;
  name: string;
  town: string;
  busTypes: BusType[];
  busCount: number;
  memberCount: number;
  adminName: string;
  pendingInviteToken: string | null;
  subscription: Subscription;
};

export type InviteInfo =
  | { valid: true; company: string; role: string; displayName: string }
  | { valid: false; reason: string };

export type PendingInvite = {
  id: string;
  token: string;
  role: string;
  displayName: string;
  whatsappNumber: string;
  expiresAt: string;
};

export type SubscriptionPayment = {
  id: string;
  paidOn: string;
  amountInr: number;
  mode: string;
  reference: string;
  paidUntil: string;
};

/** Digits only, with the India country code added to 10-digit numbers. */
export function whatsappDigits(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function inviteMessage(input: {
  company: string;
  name: string;
  link: string;
}) {
  const hello = input.name ? `Hi ${input.name},` : "Hi,";
  return `${hello}\nYou are invited to ${input.company} on Fleet Ops.\nOpen this link to create your password and join (valid for 7 days):\n${input.link}`;
}

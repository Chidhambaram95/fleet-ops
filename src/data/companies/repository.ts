import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentDetails, Subscription } from "@domain/billing/subscription";
import {
  BUS_TYPES,
  type BusType,
  type Company,
  type CompanyMember,
  type CompanyProfile,
  type InviteInfo,
  type PendingInvite,
  type SubscriptionPayment,
} from "@domain/companies/types";
import { isModuleId, type ModuleId } from "@domain/modules/modules";

function fail(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function toBusTypes(value: unknown): BusType[] {
  const list = Array.isArray(value) ? value : [];
  const types = list.filter((item): item is BusType =>
    (BUS_TYPES as readonly string[]).includes(item),
  );
  return types.length ? types : ["town"];
}

type SubscriptionRow = {
  plan_label: string;
  amount_inr: number | null;
  billing_period: Subscription["billingPeriod"];
  trial_ends_on: string | null;
  next_due_on: string | null;
};

export function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    planLabel: row.plan_label,
    amountInr: row.amount_inr,
    billingPeriod: row.billing_period,
    trialEndsOn: row.trial_ends_on,
    nextDueOn: row.next_due_on,
  };
}

type PaymentDetailsRow = {
  account_name: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
  upi_id: string;
};

function mapPaymentDetails(row: PaymentDetailsRow): PaymentDetails {
  return {
    accountName: row.account_name,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    ifsc: row.ifsc,
    upiId: row.upi_id,
  };
}

/** Quietly false until the companies migration has been run. */
export async function isSuperAdmin(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !error && Boolean(data);
}

/**
 * Company profile plus billing facts for the signed-in member. Every query is
 * soft: before the migration is applied the app still opens, just without
 * company settings or billing reminders.
 */
export async function getCompanyProfile(
  client: SupabaseClient,
  organizationId: string,
): Promise<CompanyProfile> {
  const [org, sub, pay, modules] = await Promise.all([
    client
      .from("organizations")
      .select("name, town, gstin, whatsapp_number, bus_types")
      .eq("id", organizationId)
      .maybeSingle(),
    client
      .from("org_subscriptions")
      .select("plan_label, amount_inr, billing_period, trial_ends_on, next_due_on")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    client
      .from("platform_payment_details")
      .select("account_name, bank_name, account_number, ifsc, upi_id")
      .maybeSingle(),
    // Separate and soft, so the app still opens before migration 0015 is run.
    client.from("organizations").select("enabled_modules").eq("id", organizationId).maybeSingle(),
  ]);
  const enabledRaw = modules.error ? null : (modules.data as Record<string, unknown> | null)?.enabled_modules;

  let orgRow = org.data as Record<string, unknown> | null;
  if (org.error) {
    // Older database: only the name column exists.
    const legacy = await client
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    orgRow = legacy.data as Record<string, unknown> | null;
  }

  return {
    name: typeof orgRow?.name === "string" && orgRow.name.trim() ? orgRow.name.trim() : "Fleet",
    town: typeof orgRow?.town === "string" ? orgRow.town : "",
    gstin: typeof orgRow?.gstin === "string" ? orgRow.gstin : "",
    whatsappNumber:
      typeof orgRow?.whatsapp_number === "string" ? orgRow.whatsapp_number : "",
    busTypes: toBusTypes(orgRow?.bus_types),
    enabledModules: Array.isArray(enabledRaw) ? toBusTypes(enabledRaw) : null,
    subscription: sub.data ? mapSubscription(sub.data as SubscriptionRow) : null,
    paymentDetails: pay.data ? mapPaymentDetails(pay.data as PaymentDetailsRow) : null,
  };
}

export async function updateCompanyProfile(
  client: SupabaseClient,
  organizationId: string,
  input: { name: string; town: string; gstin: string; whatsappNumber: string; enabledModules: BusType[] },
) {
  const { data, error } = await client
    .from("organizations")
    .update({
      name: input.name,
      town: input.town,
      gstin: input.gstin,
      whatsapp_number: input.whatsappNumber,
      enabled_modules: input.enabledModules,
    })
    .eq("id", organizationId)
    .select("id");
  fail(error);
  if (!data?.length) {
    throw new Error("Could not save the company details.");
  }
}

// --- Invites -------------------------------------------------------------

export async function getInvite(client: SupabaseClient, token: string): Promise<InviteInfo> {
  const { data, error } = await client.rpc("get_invite", { p_token: token });
  if (error || !data) {
    return { valid: false, reason: "This invite link could not be checked." };
  }
  const row = data as {
    valid: boolean;
    reason?: string;
    company?: string;
    role?: string;
    display_name?: string;
  };
  if (!row.valid) {
    return { valid: false, reason: row.reason ?? "This invite is not valid." };
  }
  return {
    valid: true,
    company: row.company ?? "",
    role: row.role ?? "crew",
    displayName: row.display_name ?? "",
  };
}

export async function acceptInvite(client: SupabaseClient, token: string) {
  const { data, error } = await client.rpc("accept_invite", { p_token: token });
  fail(error);
  return String(data);
}

export async function createInvite(
  client: SupabaseClient,
  input: {
    organizationId: string;
    role: string;
    displayName: string;
    whatsappNumber: string;
    busId: string | null;
  },
) {
  const { data, error } = await client.rpc("create_invite", {
    p_org: input.organizationId,
    p_role: input.role,
    p_name: input.displayName,
    p_whatsapp: input.whatsappNumber,
    p_bus_id: input.busId,
  });
  fail(error);
  return String(data);
}

export async function listPendingInvites(
  client: SupabaseClient,
  organizationId: string,
): Promise<PendingInvite[]> {
  const { data, error } = await client
    .from("org_invites")
    .select("id, token, role, display_name, whatsapp_number, expires_at")
    .eq("organization_id", organizationId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    token: row.token as string,
    role: row.role as string,
    displayName: row.display_name as string,
    whatsappNumber: row.whatsapp_number as string,
    expiresAt: row.expires_at as string,
  }));
}

export async function cancelInvite(client: SupabaseClient, inviteId: string) {
  const { error } = await client.from("org_invites").delete().eq("id", inviteId);
  fail(error);
}

// --- Super admin ---------------------------------------------------------

export async function listCompanies(client: SupabaseClient): Promise<Company[]> {
  const { data, error } = await client.rpc("admin_list_companies");
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    organizationId: row.organization_id as string,
    name: row.name as string,
    town: (row.town as string) ?? "",
    gstin: (row.gstin as string) ?? "",
    whatsappNumber: (row.whatsapp_number as string) ?? "",
    busTypes: toBusTypes(row.bus_types),
    maxBuses: row.max_buses == null ? null : Number(row.max_buses),
    deactivatedAt: (row.deactivated_at as string | null) ?? null,
    trialStartsOn: (row.trial_starts_on as string | null) ?? null,
    busCount: Number(row.bus_count ?? 0),
    memberCount: Number(row.member_count ?? 0),
    adminName: (row.admin_name as string) ?? "",
    pendingInviteToken: (row.pending_invite_token as string | null) ?? null,
    pendingInviteWhatsapp: (row.pending_invite_whatsapp as string | null) ?? "",
    subscription: {
      planLabel: (row.plan_label as string) ?? "Per operator",
      amountInr: (row.amount_inr as number | null) ?? null,
      billingPeriod: (row.billing_period as Subscription["billingPeriod"]) ?? "month",
      trialEndsOn: (row.trial_ends_on as string | null) ?? null,
      nextDueOn: (row.next_due_on as string | null) ?? null,
    },
  }));
}

export async function updateCompanyAsAdmin(
  client: SupabaseClient,
  organizationId: string,
  input: {
    name: string;
    town: string;
    gstin: string;
    whatsappNumber: string;
    busTypes: BusType[];
    maxBuses: number | null;
  },
) {
  const { error } = await client.rpc("admin_update_company", {
    p_org: organizationId,
    p_name: input.name,
    p_town: input.town,
    p_gstin: input.gstin,
    p_whatsapp: input.whatsappNumber,
    p_bus_types: input.busTypes,
    p_max_buses: input.maxBuses,
  });
  fail(error);
}

export async function listCompanyMembers(
  client: SupabaseClient,
  organizationId: string,
): Promise<CompanyMember[]> {
  const { data, error } = await client.rpc("admin_list_members", { p_org: organizationId });
  fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    userId: row.user_id as string,
    displayName: (row.display_name as string) ?? "",
    email: (row.email as string) ?? "",
    role: (row.role as string) ?? "",
    joinedAt: (row.joined_at as string) ?? "",
  }));
}

export async function setMemberRole(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
) {
  const { error } = await client.rpc("admin_set_member_role", {
    p_org: organizationId,
    p_user: userId,
    p_role: role,
  });
  fail(error);
}

export async function removeMember(client: SupabaseClient, organizationId: string, userId: string) {
  const { error } = await client.rpc("admin_remove_member", { p_org: organizationId, p_user: userId });
  fail(error);
}

export async function setCompanyActive(
  client: SupabaseClient,
  organizationId: string,
  active: boolean,
) {
  const { error } = await client.rpc("admin_set_company_active", {
    p_org: organizationId,
    p_active: active,
  });
  fail(error);
}

/** Removes the company's photos, then the company and all its records. */
export async function deleteCompanyForGood(
  client: SupabaseClient,
  organizationId: string,
  confirmName: string,
) {
  const bucket = client.storage.from("trip-sheets");
  for (const folder of [organizationId, `${organizationId}/documents`]) {
    for (;;) {
      const { data, error } = await bucket.list(folder, { limit: 100 });
      if (error) throw new Error(error.message);
      const files = (data ?? []).filter((item) => item.id).map((item) => `${folder}/${item.name}`);
      if (files.length === 0) break;
      const removed = await bucket.remove(files);
      if (removed.error) throw new Error(removed.error.message);
    }
  }
  const { error } = await client.rpc("admin_delete_company", {
    p_org: organizationId,
    p_confirm_name: confirmName,
  });
  fail(error);
}

/** Who belongs to a locked company, so the app can say it is closed. */
export async function closedCompanyName(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc("my_closed_company");
  return !error && typeof data === "string" && data ? data : null;
}

export type ReceivedPayment = SubscriptionPayment & { organizationId: string };

/** Every plan payment ever recorded, added up (not just the ones listed). */
export async function totalSubscriptionPayments(client: SupabaseClient): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("subscription_payments")
      .select("amount_inr")
      .order("id")
      .range(from, from + 999);
    fail(error);
    const rows = data ?? [];
    total += rows.reduce((sum, row) => sum + Number(row.amount_inr ?? 0), 0);
    if (rows.length < 1000) return total;
  }
}

export async function listAllSubscriptionPayments(
  client: SupabaseClient,
  limit = 200,
): Promise<ReceivedPayment[]> {
  const { data, error } = await client
    .from("subscription_payments")
    .select("id, organization_id, paid_on, amount_inr, mode, reference, paid_until")
    .order("paid_on", { ascending: false })
    .limit(limit);
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    paidOn: row.paid_on as string,
    amountInr: row.amount_inr as number,
    mode: row.mode as string,
    reference: row.reference as string,
    paidUntil: row.paid_until as string,
  }));
}

export async function createCompany(
  client: SupabaseClient,
  input: {
    name: string;
    town: string;
    busTypes: BusType[];
    gstin: string;
    adminName: string;
    adminWhatsapp: string;
  },
) {
  const { data, error } = await client.rpc("create_company", {
    p_name: input.name,
    p_town: input.town,
    p_bus_types: input.busTypes,
    p_gstin: input.gstin,
    p_admin_name: input.adminName,
    p_admin_whatsapp: input.adminWhatsapp,
  });
  fail(error);
  const row = data as { organization_id: string; token: string };
  return { organizationId: row.organization_id, token: row.token };
}

export async function listSubscriptionPayments(
  client: SupabaseClient,
  organizationId: string,
): Promise<SubscriptionPayment[]> {
  const { data, error } = await client
    .from("subscription_payments")
    .select("id, paid_on, amount_inr, mode, reference, paid_until")
    .eq("organization_id", organizationId)
    .order("paid_on", { ascending: false });
  fail(error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    paidOn: row.paid_on as string,
    amountInr: row.amount_inr as number,
    mode: row.mode as string,
    reference: row.reference as string,
    paidUntil: row.paid_until as string,
  }));
}

export async function recordPayment(
  client: SupabaseClient,
  input: {
    organizationId: string;
    paidOn: string;
    amountInr: number;
    mode: string;
    reference: string;
    paidUntil: string;
  },
) {
  const { error } = await client.rpc("record_payment", {
    p_org: input.organizationId,
    p_paid_on: input.paidOn,
    p_amount: input.amountInr,
    p_mode: input.mode,
    p_reference: input.reference,
    p_paid_until: input.paidUntil,
  });
  fail(error);
}

export async function updateSubscription(
  client: SupabaseClient,
  organizationId: string,
  patch: {
    trialEndsOn?: string;
    amountInr?: number | null;
    billingPeriod?: Subscription["billingPeriod"];
  },
) {
  const row: Record<string, unknown> = {};
  if (patch.trialEndsOn !== undefined) row.trial_ends_on = patch.trialEndsOn;
  if (patch.amountInr !== undefined) row.amount_inr = patch.amountInr;
  if (patch.billingPeriod !== undefined) row.billing_period = patch.billingPeriod;
  const { data, error } = await client
    .from("org_subscriptions")
    .update(row)
    .eq("organization_id", organizationId)
    .select("organization_id");
  fail(error);
  if (!data?.length) {
    throw new Error("Could not update that subscription.");
  }
}

export async function getPlatformPaymentDetails(
  client: SupabaseClient,
): Promise<PaymentDetails> {
  const { data, error } = await client
    .from("platform_payment_details")
    .select("account_name, bank_name, account_number, ifsc, upi_id")
    .maybeSingle();
  fail(error);
  return data
    ? mapPaymentDetails(data as PaymentDetailsRow)
    : { accountName: "", bankName: "", accountNumber: "", ifsc: "", upiId: "" };
}

export async function updatePlatformPaymentDetails(
  client: SupabaseClient,
  details: PaymentDetails,
) {
  const { data, error } = await client
    .from("platform_payment_details")
    .update({
      account_name: details.accountName,
      bank_name: details.bankName,
      account_number: details.accountNumber,
      ifsc: details.ifsc,
      upi_id: details.upiId,
    })
    .eq("id", true)
    .select("id");
  fail(error);
  if (!data?.length) {
    throw new Error("Could not save the payment details.");
  }
}

/** The module a manager is limited to, or null for every module (soft before migration 0015). */
export async function getMemberModule(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<ModuleId | null> {
  const { data, error } = await client
    .from("organization_members")
    .select("module")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  const value = error ? null : (data as Record<string, unknown> | null)?.module;
  return isModuleId(value) ? value : null;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Renewal, RenewalKind } from "@domain/renewals/types";

const PHOTO_BUCKET = "trip-sheets";

function throwIfError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");

export async function listRenewals(
  client: SupabaseClient,
  organizationId: string,
): Promise<Renewal[]> {
  const { data, error } = await client
    .from("renewals")
    .select("*")
    .eq("organization_id", organizationId)
    .order("expires_on", { ascending: false })
    .limit(2000);
  throwIfError(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: str(row.id),
    busId: typeof row.bus_id === "string" ? row.bus_id : null,
    personId: typeof row.person_id === "string" ? row.person_id : null,
    kind: str(row.kind) as RenewalKind,
    permitType: str(row.permit_type),
    expiresOn: str(row.expires_on),
    amountInr: row.amount_inr == null ? null : Number(row.amount_inr),
    paidOn: typeof row.paid_on === "string" ? row.paid_on : null,
    photoPath: str(row.photo_path),
    note: str(row.note),
  }));
}

export async function addRenewal(
  client: SupabaseClient,
  organizationId: string,
  input: Omit<Renewal, "id">,
) {
  const { error } = await client.from("renewals").insert({
    organization_id: organizationId,
    bus_id: input.busId,
    person_id: input.personId,
    kind: input.kind,
    permit_type: input.permitType,
    expires_on: input.expiresOn,
    amount_inr: input.amountInr,
    paid_on: input.paidOn,
    photo_path: input.photoPath,
    note: input.note,
  });
  throwIfError(error);
}

/** Uploads a document photo under the company's documents folder and returns its path. */
export async function uploadDocumentPhoto(
  client: SupabaseClient,
  organizationId: string,
  photo: Blob,
): Promise<string> {
  const path = `${organizationId}/documents/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(path, photo, { contentType: "image/jpeg", upsert: false });
  throwIfError(error);
  return path;
}

export async function documentPhotoUrl(client: SupabaseClient, path: string) {
  const { data, error } = await client.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
  throwIfError(error);
  return data?.signedUrl ?? "";
}

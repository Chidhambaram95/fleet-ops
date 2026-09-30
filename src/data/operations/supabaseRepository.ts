import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedUserId } from "@data/auth/session";
import type { Bus, DailyEntry, NewBus, NewDailyEntry } from "@domain/operations/types";
import {
  isUserRole,
  normalizeUserRole,
  type CrewAssignment,
  type OrganizationMember,
  type UserRole,
} from "@domain/rbac/roles";
import {
  mapBus,
  mapDailyEntry,
  type BusRow,
  type DailyEntryRow,
} from "./mappers";
import type { OperationsRepository, TeamRepository } from "./repository";

function throwIfError(error: { message: string; code?: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function isDuplicate(error: { message: string; code?: string }) {
  return error.code === "23505" || error.message.toLowerCase().includes("duplicate");
}

type MemberRow = {
  user_id: string;
  role: string;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type AssignmentRow = {
  user_id: string;
  bus_id: string;
};

export class SupabaseOperationsRepository
  implements OperationsRepository, TeamRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async listBuses(organizationId: string) {
    const { data, error } = await this.client
      .from("buses")
      .select("id, registration_number, route_label")
      .eq("organization_id", organizationId)
      .order("registration_number", { ascending: true });

    throwIfError(error);
    return ((data ?? []) as BusRow[]).map(mapBus);
  }

  async createBus(organizationId: string, input: NewBus): Promise<Bus> {
    const registrationNumber = input.registrationNumber.trim();
    const routeLabel = input.routeLabel.trim();
    if (!registrationNumber || !routeLabel) {
      throw new Error("Registration number and route are required.");
    }

    const { data, error } = await this.client
      .from("buses")
      .insert({
        organization_id: organizationId,
        registration_number: registrationNumber,
        route_label: routeLabel,
      })
      .select("id, registration_number, route_label")
      .single();

    if (error && isDuplicate(error)) {
      throw new Error("A bus with that registration number already exists.");
    }
    throwIfError(error);
    if (!data) {
      throw new Error("Could not add that bus.");
    }
    return mapBus(data as BusRow);
  }

  async updateBus(organizationId: string, busId: string, input: NewBus): Promise<Bus> {
    const registrationNumber = input.registrationNumber.trim();
    const routeLabel = input.routeLabel.trim();
    if (!registrationNumber || !routeLabel) {
      throw new Error("Registration number and route are required.");
    }

    const { data, error } = await this.client
      .from("buses")
      .update({
        registration_number: registrationNumber,
        route_label: routeLabel,
      })
      .eq("organization_id", organizationId)
      .eq("id", busId)
      .select("id, registration_number, route_label");

    if (error && isDuplicate(error)) {
      throw new Error("A bus with that registration number already exists.");
    }
    throwIfError(error);
    const row = data?.[0];
    if (!row) {
      throw new Error("Could not update that bus.");
    }
    return mapBus(row as BusRow);
  }

  async deleteBus(organizationId: string, busId: string) {
    const { data, error } = await this.client
      .from("buses")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", busId)
      .select("id");

    throwIfError(error);
    if (!data?.length) {
      throw new Error("Could not delete that bus.");
    }
  }

  async listEntriesByDate(organizationId: string, date: string) {
    const { data, error } = await this.client
      .from("daily_entries")
      .select(
        "id, bus_id, entry_date, kind, category, amount_inr, note, created_at",
      )
      .eq("organization_id", organizationId)
      .eq("entry_date", date)
      .order("created_at", { ascending: false });

    throwIfError(error);
    return ((data ?? []) as DailyEntryRow[]).map(mapDailyEntry);
  }

  async addEntry(organizationId: string, input: NewDailyEntry): Promise<DailyEntry> {
    const amountInr = Math.round(input.amountInr);
    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      throw new Error("Amount must be a whole rupee greater than 0.");
    }

    const { data: bus, error: busError } = await this.client
      .from("buses")
      .select("id")
      .eq("id", input.busId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    throwIfError(busError);
    if (!bus) {
      throw new Error("That bus is not in this organization.");
    }

    const createdBy = await getAuthenticatedUserId(this.client);

    const { data, error } = await this.client
      .from("daily_entries")
      .insert({
        organization_id: organizationId,
        bus_id: input.busId,
        entry_date: input.date,
        kind: input.kind,
        category: input.category,
        amount_inr: amountInr,
        note: input.note.trim(),
        created_by: createdBy,
      })
      .select(
        "id, bus_id, entry_date, kind, category, amount_inr, note, created_at",
      )
      .single();

    throwIfError(error);
    if (!data) {
      throw new Error("Save did not return an entry.");
    }
    return mapDailyEntry(data as DailyEntryRow);
  }

  async removeEntry(organizationId: string, id: string) {
    const { error } = await this.client
      .from("daily_entries")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", id);
    throwIfError(error);
  }

  async getOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
    const { data, error } = await this.client
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    throwIfError(error);
    const members = (data ?? []) as MemberRow[];
    if (members.length === 0) {
      return [];
    }

    const userIds = members.map((member) => member.user_id);
    const [profilesResult, assignmentsResult] = await Promise.all([
      this.client.from("profiles").select("id, display_name").in("id", userIds),
      this.client
        .from("crew_assignments")
        .select("user_id, bus_id")
        .eq("organization_id", organizationId)
        .in("user_id", userIds),
    ]);

    throwIfError(profilesResult.error);
    throwIfError(assignmentsResult.error);

    const names = new Map(
      ((profilesResult.data ?? []) as ProfileRow[]).map((profile) => [
        profile.id,
        profile.display_name?.trim() || "",
      ]),
    );
    const buses = new Map(
      ((assignmentsResult.data ?? []) as AssignmentRow[]).map((assignment) => [
        assignment.user_id,
        assignment.bus_id,
      ]),
    );

    return members.map((member) => {
      const role = normalizeUserRole(member.role);
      if (!role) {
        throw new Error(`Unknown role for ${member.user_id}.`);
      }
      return {
        userId: member.user_id,
        displayName: names.get(member.user_id) || "Member",
        role,
        busId: buses.get(member.user_id) ?? null,
      };
    });
  }

  async addOrganizationMember(organizationId: string, userId: string, role: UserRole) {
    if (!isUserRole(role)) {
      throw new Error("Choose a valid role.");
    }

    const { data, error } = await this.client
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        role,
      })
      .select("user_id");

    if (error && isDuplicate(error)) {
      throw new Error("That person is already in this organization.");
    }
    throwIfError(error);
    if (!data?.length) {
      throw new Error("Could not add that member.");
    }
  }

  async updateMemberRole(organizationId: string, userId: string, role: UserRole) {
    if (!isUserRole(role)) {
      throw new Error("Choose a valid role.");
    }

    if (role !== "admin") {
      const { data: target, error: targetError } = await this.client
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();

      throwIfError(targetError);
      const currentRole =
        target && typeof target.role === "string"
          ? normalizeUserRole(target.role)
          : null;
      if (currentRole === "admin") {
        const { count, error: countError } = await this.client
          .from("organization_members")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("role", ["owner", "admin"]);

        throwIfError(countError);
        if ((count ?? 0) <= 1) {
          throw new Error("The organization needs at least one admin.");
        }
      }
    }

    const { data, error } = await this.client
      .from("organization_members")
      .update({ role })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .select("user_id");

    throwIfError(error);
    if (!data?.length) {
      throw new Error("Could not update that member.");
    }

    if (role !== "crew") {
      const { error: clearError } = await this.client
        .from("crew_assignments")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      throwIfError(clearError);
    }
  }

  async assignCrewToBus(organizationId: string, userId: string, busId: string) {
    const { data: bus, error: busError } = await this.client
      .from("buses")
      .select("id")
      .eq("id", busId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    throwIfError(busError);
    if (!bus) {
      throw new Error("That bus is not in this organization.");
    }

    const { data, error } = await this.client
      .from("crew_assignments")
      .upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          bus_id: busId,
        },
        { onConflict: "organization_id,user_id" },
      )
      .select("user_id");

    throwIfError(error);
    if (!data?.length) {
      throw new Error("Could not assign that vehicle.");
    }
  }

  async getCrewAssignment(
    organizationId: string,
    userId: string,
  ): Promise<CrewAssignment | null> {
    const { data, error } = await this.client
      .from("crew_assignments")
      .select("bus_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    throwIfError(error);
    if (!data || typeof data.bus_id !== "string") {
      return null;
    }
    return { busId: data.bus_id };
  }
}

export function createSupabaseOperationsRepository(client: SupabaseClient) {
  return new SupabaseOperationsRepository(client);
}

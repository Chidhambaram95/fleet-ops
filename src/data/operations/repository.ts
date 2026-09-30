import type {
  CrewAssignment,
  OrganizationMember,
  UserRole,
} from "@domain/rbac/roles";
import type { Bus, DailyEntry, NewBus, NewDailyEntry } from "@domain/operations/types";

/** Platform-agnostic operations store. Next.js and React Native both call this. */
export type OperationsRepository = {
  listBuses: (organizationId: string) => Promise<Bus[]>;
  createBus: (organizationId: string, input: NewBus) => Promise<Bus>;
  updateBus: (organizationId: string, busId: string, input: NewBus) => Promise<Bus>;
  deleteBus: (organizationId: string, busId: string) => Promise<void>;
  listEntriesByDate: (organizationId: string, date: string) => Promise<DailyEntry[]>;
  addEntry: (organizationId: string, input: NewDailyEntry) => Promise<DailyEntry>;
  removeEntry: (organizationId: string, id: string) => Promise<void>;
};

export type TeamRepository = {
  getOrganizationMembers: (organizationId: string) => Promise<OrganizationMember[]>;
  addOrganizationMember: (
    organizationId: string,
    userId: string,
    role: UserRole,
  ) => Promise<void>;
  updateMemberRole: (
    organizationId: string,
    userId: string,
    role: UserRole,
  ) => Promise<void>;
  assignCrewToBus: (
    organizationId: string,
    userId: string,
    busId: string,
  ) => Promise<void>;
  getCrewAssignment: (
    organizationId: string,
    userId: string,
  ) => Promise<CrewAssignment | null>;
};

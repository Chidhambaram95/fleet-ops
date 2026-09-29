import type { Bus, DailyEntry, NewDailyEntry } from "@domain/operations/types";

/** Platform-agnostic operations store. Next.js and React Native both call this. */
export type OperationsRepository = {
  listBuses: (organizationId: string) => Promise<Bus[]>;
  listEntriesByDate: (organizationId: string, date: string) => Promise<DailyEntry[]>;
  addEntry: (organizationId: string, input: NewDailyEntry) => Promise<DailyEntry>;
  removeEntry: (organizationId: string, id: string) => Promise<void>;
};

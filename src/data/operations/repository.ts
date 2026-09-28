import type { Bus, DailyEntry, NewDailyEntry } from "@domain/operations/types";

/** Platform-agnostic operations store. Next.js and React Native both call this. */
export type OperationsRepository = {
  listBuses: () => Promise<Bus[]>;
  listEntriesByDate: (date: string) => Promise<DailyEntry[]>;
  addEntry: (input: NewDailyEntry) => Promise<DailyEntry>;
  removeEntry: (id: string) => Promise<void>;
};

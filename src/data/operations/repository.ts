import type { Bus, DailyEntry, NewDailyEntry } from "@domain/operations/types";

/** Platform-agnostic operations store. Next.js and React Native both call this. */
export type OperationsRepository = {
  listBuses: () => Bus[];
  listEntriesByDate: (date: string) => DailyEntry[];
  addEntry: (input: NewDailyEntry) => DailyEntry;
  removeEntry: (id: string) => void;
};

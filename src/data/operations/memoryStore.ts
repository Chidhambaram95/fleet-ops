import type { DailyEntry, NewDailyEntry } from "@domain/operations/types";
import { SEED_BUSES } from "./seed";
import type { OperationsRepository } from "./repository";

export type JsonStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const STORAGE_KEY = "fleet-ops:daily-entries:v1";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readEntries(storage: JsonStorage): DailyEntry[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DailyEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(storage: JsonStorage, entries: DailyEntry[]) {
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function createLocalOperationsRepository(
  storage: JsonStorage,
): OperationsRepository {
  return {
    listBuses() {
      return SEED_BUSES;
    },
    listEntriesByDate(date) {
      return readEntries(storage)
        .filter((entry) => entry.date === date)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    addEntry(input: NewDailyEntry) {
      const entry: DailyEntry = {
        ...input,
        id: createId(),
        createdAt: new Date().toISOString(),
      };
      const entries = readEntries(storage);
      writeEntries(storage, [entry, ...entries]);
      return entry;
    },
    removeEntry(id) {
      writeEntries(
        storage,
        readEntries(storage).filter((entry) => entry.id !== id),
      );
    },
  };
}

export function createBrowserOperationsRepository(): OperationsRepository | null {
  if (typeof window === "undefined") {
    return null;
  }
  return createLocalOperationsRepository(window.localStorage);
}

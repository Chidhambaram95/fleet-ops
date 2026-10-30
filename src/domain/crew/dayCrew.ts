import type { CrewJob, CrewPerson } from "@domain/money/types";

/** The jobs on a Town bus each day. Driver and conductor are needed to close the day. */
export const DUTIES: readonly CrewJob[] = ["driver", "conductor", "cleaner"];
export const NEEDED_DUTIES: readonly CrewJob[] = ["driver", "conductor"];

export const JOB_LABELS: Record<CrewJob, string> = {
  driver: "Driver",
  conductor: "Conductor",
  cleaner: "Cleaner",
};

/** Who did one job on one bus on one day. */
export type DayCrewRow = {
  id: string;
  day: string;
  busId: string;
  duty: CrewJob;
  personId: string;
};

/** Each bus's crew for the day: bus id → duty → person id. */
export type DayCrewMap = Map<string, Partial<Record<CrewJob, string>>>;

export function dayCrewMap(rows: readonly DayCrewRow[]): DayCrewMap {
  const map: DayCrewMap = new Map();
  for (const row of rows) {
    map.set(row.busId, { ...map.get(row.busId), [row.duty]: row.personId });
  }
  return map;
}

/** Duties still to fill on a bus before the day can be closed. */
export function missingDuties(crew: DayCrewMap, busId: string): CrewJob[] {
  const onBus = crew.get(busId) ?? {};
  return NEEDED_DUTIES.filter((duty) => !onBus[duty]);
}

/**
 * Yesterday's crew for the slots still empty today, skipping anyone who has
 * left or is already on another bus in the same job today.
 */
export function copyFromDay(
  previous: DayCrewMap,
  today: DayCrewMap,
  busIds: readonly string[],
  people: readonly CrewPerson[],
): { busId: string; duty: CrewJob; personId: string }[] {
  const active = new Set(people.filter((person) => person.active).map((person) => person.id));
  const taken = new Set<string>();
  for (const onBus of today.values()) {
    for (const duty of DUTIES) {
      const id = onBus[duty];
      if (id) taken.add(`${duty}:${id}`);
    }
  }
  const fills: { busId: string; duty: CrewJob; personId: string }[] = [];
  for (const busId of busIds) {
    const before = previous.get(busId) ?? {};
    const now = today.get(busId) ?? {};
    for (const duty of DUTIES) {
      const personId = before[duty];
      if (!personId || now[duty] || !active.has(personId) || taken.has(`${duty}:${personId}`)) continue;
      taken.add(`${duty}:${personId}`);
      fills.push({ busId, duty, personId });
    }
  }
  return fills;
}

/** People to offer for a job: those hired for it first, then the rest of the Town crew. */
export function peopleForDuty(people: readonly CrewPerson[], duty: CrewJob, selectedId = "") {
  const usable = people.filter((person) => person.module === "town" && (person.active || person.id === selectedId));
  return {
    main: usable.filter((person) => person.job === duty),
    others: usable.filter((person) => person.job !== duty),
  };
}

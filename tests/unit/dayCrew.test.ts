import { describe, expect, it } from "vitest";
import { copyFromDay, dayCrewMap, missingDuties, peopleForDuty } from "@domain/crew/dayCrew";
import type { CrewPerson } from "@domain/money/types";

function person(id: string, job: CrewPerson["job"], overrides: Partial<CrewPerson> = {}): CrewPerson {
  return { id, name: id, job, phone: "", monthlySalaryInr: 0, licenceNo: "", active: true, module: "town", ...overrides };
}

const row = (busId: string, duty: CrewPerson["job"], personId: string) => ({ id: `${busId}${duty}`, day: "2026-10-30", busId, duty, personId });

describe("Town day crew", () => {
  it("needs a driver and a conductor, not a cleaner", () => {
    const crew = dayCrewMap([row("b1", "driver", "d1"), row("b2", "driver", "d2"), row("b2", "conductor", "c2")]);
    expect(missingDuties(crew, "b1")).toEqual(["conductor"]);
    expect(missingDuties(crew, "b2")).toEqual([]);
    expect(missingDuties(crew, "b3")).toEqual(["driver", "conductor"]);
  });

  it("copies yesterday's crew into empty slots only, skipping people who left or are already on duty", () => {
    const yesterday = dayCrewMap([
      row("b1", "driver", "d1"),
      row("b1", "conductor", "c1"),
      row("b2", "driver", "d2"),
      row("b2", "cleaner", "x1"),
    ]);
    const today = dayCrewMap([row("b1", "driver", "d9"), row("b3", "driver", "d2")]);
    const people = [person("d1", "driver"), person("c1", "conductor"), person("d2", "driver"), person("x1", "cleaner", { active: false })];
    expect(copyFromDay(yesterday, today, ["b1", "b2", "b3"], people)).toEqual([{ busId: "b1", duty: "conductor", personId: "c1" }]);
  });

  it("offers people hired for the job first, and keeps someone who left if already picked", () => {
    const people = [
      person("d1", "driver"),
      person("c1", "conductor"),
      person("c2", "conductor", { active: false }),
      person("o1", "driver", { module: "omni" }),
    ];
    const choices = peopleForDuty(people, "conductor", "c2");
    expect(choices.main.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(choices.others.map((item) => item.id)).toEqual(["d1"]);
  });
});

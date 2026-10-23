import { describe, expect, it } from "vitest";
import { changedByLabel, changedFields, changeTitle } from "@domain/history/describe";
import type { HistoryRow } from "@domain/history/types";

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    id: 1,
    table: "daily_entries",
    rowId: "e1",
    action: "update",
    busId: null,
    module: "town",
    changedBy: "u1",
    changedByName: "Ravi",
    changedAt: "2026-10-20T10:00:00Z",
    reason: "",
    oldData: null,
    newData: null,
    ...overrides,
  };
}

describe("change history wording", () => {
  it("names the record, the action and the amount", () => {
    expect(changeTitle(row({ action: "insert", newData: { amount_inr: 2000 } }))).toBe("Cash entry added · ₹2,000");
    expect(changeTitle(row({ action: "delete", table: "trips", oldData: {} }))).toBe("Trip sheet deleted");
  });

  it("lists only the fields that changed", () => {
    const lines = changedFields(
      row({
        oldData: { id: "e1", amount_inr: 2000, note: "", updated_at: "a" },
        newData: { id: "e1", amount_inr: 2500, note: "Bill 42", updated_at: "b" },
      }),
    );
    expect(lines).toEqual(["Amount: ₹2,000 → ₹2,500", "Note: blank → Bill 42"]);
  });

  it("notices changed trip lines", () => {
    const lines = changedFields(
      row({ table: "trips", oldData: { items: [{ amount_inr: 1 }] }, newData: { items: [{ amount_inr: 2 }] } }),
    );
    expect(lines).toEqual(["Trip lines changed"]);
  });

  it("says who changed it", () => {
    expect(changedByLabel(row({}))).toBe("Ravi");
    expect(changedByLabel(row({ changedByName: "" }))).toBe("Someone in the team");
    expect(changedByLabel(row({ changedBy: null, changedByName: "" }))).toBe("Fleet Ops support");
  });
});

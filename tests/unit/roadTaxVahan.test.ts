import { describe, expect, it } from "vitest";
import {
  addDays,
  buildVahanJob,
  fromVahanDate,
  isValidChassisLast5,
  missingForVahan,
  normalizeChassisLast5,
  normalizeOwnerName,
  normalizeRegistration,
  quarterContaining,
  readVahanJob,
  taxQuarterOptions,
  toVahanDate,
  vahanStartUrl,
  VAHAN_HOME_URL,
} from "@domain/roadTax/vahan";

describe("names and numbers", () => {
  it("compares registration numbers without spaces or dashes", () => {
    expect(normalizeRegistration("tn 45 ab-1234")).toBe("TN45AB1234");
  });

  it("ignores dots, commas, case and extra spaces in owner names", () => {
    expect(normalizeOwnerName("  s.  kumar ")).toBe("S KUMAR");
    expect(normalizeOwnerName("C.T.PERIYASAMY")).toBe("C T PERIYASAMY");
    expect(normalizeOwnerName("Kumar, S")).toBe("KUMAR S");
  });

  it("accepts exactly 5 letters or digits for the chassis", () => {
    expect(normalizeChassisLast5(" 50-181 ")).toBe("50181");
    expect(isValidChassisLast5("50181")).toBe(true);
    expect(isValidChassisLast5("AB12C")).toBe(true);
    expect(isValidChassisLast5("5018")).toBe(false);
    expect(isValidChassisLast5("501811")).toBe(false);
    expect(isValidChassisLast5("ab12c")).toBe(false);
  });

  it("lists what a bus still needs before Vahan", () => {
    expect(missingForVahan({ chassisLast5: "", ownerName: "" })).toEqual(["chassis last 5", "owner name"]);
    expect(missingForVahan({ chassisLast5: "50181", ownerName: " " })).toEqual(["owner name"]);
    expect(missingForVahan({ chassisLast5: "50181", ownerName: "S KUMAR" })).toEqual([]);
  });
});

describe("dates and quarters", () => {
  it("converts to and from Vahan's DD-MM-YYYY", () => {
    expect(toVahanDate("2026-10-01")).toBe("01-10-2026");
    expect(fromVahanDate("31-12-2026")).toBe("2026-12-31");
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("finds the calendar quarter of a date", () => {
    expect(quarterContaining("2026-11-13")).toEqual({ from: "2026-10-01", to: "2026-12-31", label: "Oct – Dec 2026" });
    expect(quarterContaining("2027-02-28")).toEqual({ from: "2027-01-01", to: "2027-03-31", label: "Jan – Mar 2027" });
    expect(quarterContaining("2026-06-30").to).toBe("2026-06-30");
    expect(quarterContaining("2026-09-01").to).toBe("2026-09-30");
  });

  it("offers the next due quarter first, the day after tax is paid till", () => {
    const options = taxQuarterOptions("2026-09-30", "2026-11-13");
    expect(options.map((quarter) => [quarter.from, quarter.to])).toEqual([
      ["2026-10-01", "2026-12-31"],
      ["2027-01-01", "2027-03-31"],
      ["2027-04-01", "2027-06-30"],
      ["2027-07-01", "2027-09-30"],
    ]);
  });

  it("starts mid-quarter when the last payment ended mid-quarter", () => {
    const [first, second] = taxQuarterOptions("2026-10-15", "2026-11-13", 2);
    expect(first).toEqual({ from: "2026-10-16", to: "2026-12-31", label: "Oct – Dec 2026" });
    expect(second.from).toBe("2027-01-01");
  });

  it("starts from this quarter when no road tax is saved", () => {
    expect(taxQuarterOptions(null, "2026-11-13", 1)[0]).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
      label: "Oct – Dec 2026",
    });
  });
});

describe("the job handed to the helper", () => {
  const job = buildVahanJob({
    registrationNumber: " TN 45 AB 1234 ",
    chassisLast5: "50181",
    ownerName: "s. kumar",
    quarter: { from: "2026-10-01", to: "2026-12-31", label: "Oct – Dec 2026" },
    lastAmountInr: 38219,
    now: 1_000,
  });

  it("carries Vahan-style dates and cleaned names", () => {
    expect(job).toEqual({
      v: 1,
      reg: "TN 45 AB 1234",
      chassisLast5: "50181",
      ownerName: "S KUMAR",
      from: "01-10-2026",
      to: "31-12-2026",
      lastAmountInr: 38219,
      createdAt: 1_000,
    });
  });

  it("goes after # in the Vahan link and reads back the same", () => {
    const url = vahanStartUrl(job);
    expect(url.startsWith(`${VAHAN_HOME_URL}#fleetops=`)).toBe(true);
    expect(url).not.toContain("KUMAR");
    expect(readVahanJob(new URL(url).hash)).toEqual(job);
  });

  it("keeps non-English owner names intact", () => {
    const tamil = { ...job, ownerName: "முருகன்" };
    expect(readVahanJob(new URL(vahanStartUrl(tamil)).hash)?.ownerName).toBe("முருகன்");
  });

  it("ignores links that are not a Fleet Ops job", () => {
    expect(readVahanJob("")).toBeNull();
    expect(readVahanJob("#other=1")).toBeNull();
    expect(readVahanJob("#fleetops=not-json")).toBeNull();
  });
});

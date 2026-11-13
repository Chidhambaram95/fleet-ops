import { describe, expect, it } from "vitest";
import "../../extensions/vahan-helper/check.js";
import { buildVahanJob, vahanStartUrl, type VahanJob } from "@domain/roadTax/vahan";

type Row = { id: string; status: "ok" | "bad" | "warn" | "info"; expected: string; seen: string };
type Helper = {
  JOB_MAX_AGE_MS: number;
  readJob: (hash: string) => VahanJob | null;
  isFresh: (job: VahanJob | null, now: number) => boolean;
  parseAmount: (text: string) => number | null;
  checkVahan: (
    job: VahanJob,
    seen: { reg: string; owner: string; mode: string; from: string; to: string; total: string },
  ) => { result: "ok" | "warn" | "stop"; rows: Row[] };
};

const helper = (globalThis as unknown as { FleetOpsVahan: Helper }).FleetOpsVahan;

const job = buildVahanJob({
  registrationNumber: "TN 45 AB 1234",
  chassisLast5: "50181",
  ownerName: "S KUMAR",
  quarter: { from: "2026-10-01", to: "2026-12-31", label: "Oct – Dec 2026" },
  lastAmountInr: 38219,
  now: 1_000_000,
});

// What Vahan showed on 13 Nov 2026 for a town bus (owner changed for the test).
const seen = {
  reg: "TN45AB1234",
  owner: "S. KUMAR",
  mode: "Q/Quarterly(1)",
  from: "01-10-2026",
  to: "31-12-2026",
  total: "38229.0",
};

const status = (rows: Row[]) => Object.fromEntries(rows.map((row) => [row.id, row.status]));

describe("helper reads the job from the Fleet Ops link", () => {
  it("reads the same job Fleet Ops wrote", () => {
    expect(helper.readJob(new URL(vahanStartUrl(job)).hash)).toEqual(job);
  });

  it("refuses broken or foreign links", () => {
    expect(helper.readJob("#fleetops=abc")).toBeNull();
    expect(helper.readJob("#something=else")).toBeNull();
    expect(helper.readJob("")).toBeNull();
  });

  it("ignores a job older than 30 minutes", () => {
    expect(helper.isFresh(job, job.createdAt + 60_000)).toBe(true);
    expect(helper.isFresh(job, job.createdAt + helper.JOB_MAX_AGE_MS + 1)).toBe(false);
    expect(helper.isFresh(job, job.createdAt - 1)).toBe(false);
    expect(helper.isFresh(null, job.createdAt)).toBe(false);
  });
});

describe("helper checks what Vahan shows", () => {
  it("is all green when vehicle, owner and period match", () => {
    const check = helper.checkVahan(job, seen);
    expect(check.result).toBe("ok");
    expect(status(check.rows)).toEqual({ vehicle: "ok", owner: "ok", period: "ok", amount: "ok" });
  });

  it("stops on a different owner", () => {
    const check = helper.checkVahan(job, { ...seen, owner: "R MURUGAN" });
    expect(check.result).toBe("stop");
    expect(status(check.rows).owner).toBe("bad");
  });

  it("stops on a different vehicle", () => {
    expect(helper.checkVahan(job, { ...seen, reg: "TN45AB1235" }).result).toBe("stop");
  });

  it("stops when the owner or vehicle cannot be read", () => {
    expect(helper.checkVahan(job, { ...seen, owner: "" }).result).toBe("stop");
    expect(helper.checkVahan(job, { ...seen, reg: "" }).result).toBe("stop");
  });

  it("stops on a different quarter", () => {
    const check = helper.checkVahan(job, { ...seen, from: "01-01-2027", to: "31-03-2027" });
    expect(check.result).toBe("stop");
    expect(status(check.rows).period).toBe("bad");
  });

  it("stops when Vahan is not on quarterly tax", () => {
    expect(helper.checkVahan(job, { ...seen, mode: "Y/Yearly(1)" }).result).toBe("stop");
  });

  it("warns when the amount moves more than 10% from last time", () => {
    const check = helper.checkVahan(job, { ...seen, total: "45000.0" });
    expect(check.result).toBe("warn");
    expect(status(check.rows).amount).toBe("warn");
    expect(helper.checkVahan(job, { ...seen, total: "41000.0" }).result).toBe("ok");
  });

  it("only informs about the amount when nothing was paid before", () => {
    const check = helper.checkVahan({ ...job, lastAmountInr: null }, seen);
    expect(check.result).toBe("ok");
    expect(status(check.rows).amount).toBe("info");
  });

  it("stops when the amount cannot be read", () => {
    expect(helper.checkVahan(job, { ...seen, total: "" }).result).toBe("stop");
  });

  it("reads Vahan amounts", () => {
    expect(helper.parseAmount("38229.0")).toBe(38229);
    expect(helper.parseAmount("Rs. 38,229.50")).toBe(38229.5);
    expect(helper.parseAmount("")).toBeNull();
  });
});

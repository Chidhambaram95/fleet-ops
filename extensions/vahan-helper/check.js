// Fleet Ops Vahan helper: reading the job and checking what Vahan shows.
// Plain script (no build step). Loaded before content.js, and by the unit
// tests in tests/unit/vahanHelperCheck.test.ts. Keep in step with
// src/domain/roadTax/vahan.ts (same job format and the same name rules).
(function (root) {
  "use strict";

  var JOB_KEY = "fleetops";
  var JOB_VERSION = 1;
  /** A job older than this is ignored, so an old link cannot start a payment later. */
  var JOB_MAX_AGE_MS = 30 * 60 * 1000;
  /** The amount is flagged when it differs from the last payment by more than this. */
  var AMOUNT_TOLERANCE = 0.1;

  function normalizeRegistration(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function normalizeOwnerName(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fromBase64Url(text) {
    var padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** The job in a link's "#" part, or null. */
  function readJob(hash) {
    var match = new RegExp("(?:^#?|&)" + JOB_KEY + "=([A-Za-z0-9_-]+)").exec(hash || "");
    if (!match) return null;
    try {
      var job = JSON.parse(fromBase64Url(match[1]));
      if (!job || job.v !== JOB_VERSION) return null;
      if (typeof job.reg !== "string" || typeof job.chassisLast5 !== "string") return null;
      if (typeof job.ownerName !== "string" || typeof job.from !== "string" || typeof job.to !== "string") return null;
      if (typeof job.createdAt !== "number") return null;
      return job;
    } catch {
      return null;
    }
  }

  function isFresh(job, now) {
    return Boolean(job) && now - job.createdAt >= 0 && now - job.createdAt <= JOB_MAX_AGE_MS;
  }

  /** "38,229.0" → 38229; null when it is not a number. */
  function parseAmount(text) {
    var match = /\d[\d,]*(?:\.\d+)?/.exec(String(text || ""));
    if (!match) return null;
    var value = Number(match[0].replace(/,/g, ""));
    return isFinite(value) ? value : null;
  }

  function rupees(amount) {
    return "₹" + Math.round(amount).toLocaleString("en-IN");
  }

  /**
   * Compares the Fleet Ops job with what Vahan shows.
   * seen: { reg, owner, mode, from, to, total } read from the Vahan page.
   * Each row: { id, label, expected, seen, status: "ok" | "bad" | "warn" | "info" }.
   * result: "stop" when anything is "bad", "warn" when anything is "warn", else "ok".
   */
  function checkVahan(job, seen) {
    var rows = [];
    var seenReg = normalizeRegistration(seen.reg);
    rows.push({
      id: "vehicle",
      label: "Vehicle",
      expected: job.reg,
      seen: seen.reg || "not found on the page",
      status: seenReg && seenReg === normalizeRegistration(job.reg) ? "ok" : "bad",
    });
    var seenOwner = normalizeOwnerName(seen.owner);
    rows.push({
      id: "owner",
      label: "Owner",
      expected: normalizeOwnerName(job.ownerName),
      seen: seenOwner || "not found on the page",
      status: seenOwner && seenOwner === normalizeOwnerName(job.ownerName) ? "ok" : "bad",
    });
    var quarterly = /^Q/i.test(String(seen.mode || "").trim());
    var samePeriod = String(seen.from || "").trim() === job.from && String(seen.to || "").trim() === job.to;
    rows.push({
      id: "period",
      label: "Period",
      expected: job.from + " to " + job.to + " (quarterly)",
      seen:
        (seen.from || "?") + " to " + (seen.to || "?") + (quarterly ? " (quarterly)" : " (" + (seen.mode || "mode not found") + ")"),
      status: samePeriod && quarterly ? "ok" : "bad",
    });
    var total = parseAmount(seen.total);
    var amountRow = {
      id: "amount",
      label: "Amount",
      expected: job.lastAmountInr != null ? "last paid " + rupees(job.lastAmountInr) : "no earlier payment saved",
      seen: total != null ? rupees(total) : "not found on the page",
      status: "info",
    };
    if (total == null) {
      amountRow.status = "bad";
    } else if (job.lastAmountInr != null && job.lastAmountInr > 0) {
      var change = Math.abs(total - job.lastAmountInr) / job.lastAmountInr;
      amountRow.status = change > AMOUNT_TOLERANCE ? "warn" : "ok";
    }
    rows.push(amountRow);

    var result = "ok";
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].status === "bad") result = "stop";
      else if (rows[i].status === "warn" && result === "ok") result = "warn";
    }
    return { result: result, rows: rows };
  }

  root.FleetOpsVahan = {
    JOB_MAX_AGE_MS: JOB_MAX_AGE_MS,
    normalizeRegistration: normalizeRegistration,
    normalizeOwnerName: normalizeOwnerName,
    readJob: readJob,
    isFresh: isFresh,
    parseAmount: parseAmount,
    checkVahan: checkVahan,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

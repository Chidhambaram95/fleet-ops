"use client";

import { useState } from "react";
import {
  paymentDetailsText,
  shortDate,
  type PaymentDetails,
  type SubscriptionStatus,
} from "@domain/billing/subscription";

export function BillingNotice({
  status,
  isAdminOrManager,
  amountInr,
  details,
}: {
  status: SubscriptionStatus;
  isAdminOrManager: boolean;
  amountInr: number | null;
  details: PaymentDetails | null;
}) {
  const [bannerHidden, setBannerHidden] = useState(false);
  const [popupOpen, setPopupOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const dueLabel = status.dueOn ? shortDate(status.dueOn) : "";

  if (status.state === "ok") {
    return null;
  }

  async function copyDetails() {
    if (!details) return;
    try {
      await navigator.clipboard.writeText(paymentDetailsText(details, amountInr));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const rows: [string, string][] = details
    ? [
        ["Account name", details.accountName],
        ["Bank", details.bankName],
        ["A/C number", details.accountNumber],
        ["IFSC", details.ifsc],
        ["UPI ID", details.upiId],
      ]
    : [];

  if (status.state === "due_soon") {
    if (!isAdminOrManager || bannerHidden) return null;
    return (
      <div className="mx-auto mt-3 w-full max-w-6xl px-4 md:px-8">
        <div className="flex items-center gap-3 rounded-2xl border border-[#F0DDB8] bg-white py-2.5 pl-3.5 pr-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF5E5] text-[#8A5300]">
            <CalendarIcon />
          </span>
          <div className="flex min-w-0 flex-1 flex-col text-[13px]">
            <span className="font-bold">
              {status.onTrial
                ? `Free trial ends on ${dueLabel}`
                : `Fleet Ops plan renews on ${dueLabel}`}
            </span>
            <button
              type="button"
              onClick={() => setShowDetails((open) => !open)}
              className="min-h-0 self-start font-bold text-[#3A3FB8]"
            >
              {showDetails ? "Hide payment details" : "See payment details ›"}
            </button>
          </div>
          <button
            type="button"
            aria-label="Hide for now"
            onClick={() => setBannerHidden(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-[#5B5E7A]"
          >
            ✕
          </button>
        </div>
        {showDetails ? (
          <div className="mt-2 flex flex-col gap-2 rounded-2xl bg-white p-3.5 text-[13px]">
            {rows.length === 0 ? (
              <p className="text-[#5B5E7A]">Payment details will be shared by Fleet Ops.</p>
            ) : (
              rows
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-[#5B5E7A]">{label}</span>
                    <span className="font-bold">{value}</span>
                  </div>
                ))
            )}
            {details ? (
              <button
                type="button"
                onClick={() => void copyDetails()}
                className="rounded-2xl bg-[#1A1B2E] text-sm font-bold text-white"
              >
                {copied ? "Copied" : "Copy payment details"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const viewOnly = status.state === "view_only";
  return (
    <>
      <div
        className={`mx-auto mt-3 w-full max-w-6xl px-4 md:px-8 text-[13px] font-bold`}
        role="status"
      >
        <div className="rounded-2xl bg-[#FDECEA] px-3.5 py-2.5 text-[#7A2A1C]">
          {viewOnly
            ? `Payment overdue since ${dueLabel}. The app is view-only until the payment is received.`
            : `Plan payment overdue since ${dueLabel}`}
        </div>
      </div>
      {popupOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1B2E]/60 p-5">
          <section
            role="dialog"
            aria-label="Payment overdue"
            className="flex max-h-full w-full max-w-sm flex-col items-center gap-3 overflow-y-auto rounded-[32px] bg-white px-5 pb-4 pt-6 text-center"
          >
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded-3xl bg-[#FDECEA] text-[#A3321C]">
              <WarningIcon />
            </span>
            <h2 className="text-[21px] font-extrabold">Payment overdue</h2>
            <p className="text-sm text-[#5B5E7A]">
              Your Fleet Ops plan was due on {dueLabel}.
              {amountInr ? ` Please pay ₹${amountInr.toLocaleString("en-IN")}` : " Please pay"} by
              bank transfer or UPI.
            </p>
            {rows.some(([, value]) => value) ? (
              <div className="flex w-full flex-col gap-2 rounded-[18px] bg-[#F3F4FB] px-3.5 py-3 text-left text-[13px]">
                {rows
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <span className="text-[#5B5E7A]">{label}</span>
                      <span className="font-bold">{value}</span>
                    </div>
                  ))}
              </div>
            ) : null}
            {details ? (
              <button
                type="button"
                onClick={() => void copyDetails()}
                className="h-[50px] w-full rounded-2xl bg-[#1A1B2E] text-[15px] font-bold text-white"
              >
                {copied ? "Copied" : "Copy payment details"}
              </button>
            ) : null}
            <p className="text-xs text-[#5B5E7A]">
              Already paid? It will clear once Fleet Ops confirms it.
            </p>
            <button
              type="button"
              onClick={() => setPopupOpen(false)}
              className="h-11 text-[13px] font-semibold text-[#5B5E7A]"
            >
              Close
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

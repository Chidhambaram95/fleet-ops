"use client";

import { useState } from "react";
import {
  inviteMessage,
  whatsappDigits,
} from "@domain/companies/types";

/** Share an invite from the sender's own WhatsApp: a wa.me link, no paid service. */
export function InviteShare({
  token,
  company,
  name,
  whatsappNumber,
  tone = "light",
}: {
  token: string;
  company: string;
  name: string;
  whatsappNumber: string;
  tone?: "light" | "dark";
}) {
  const [copied, setCopied] = useState(false);
  const link = `${typeof window === "undefined" ? "" : window.location.origin}/invite/${token}`;
  const text = inviteMessage({ company, name, link });
  const digits = whatsappDigits(whatsappNumber);
  const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={waUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center rounded-2xl bg-[#25D366] px-4 text-sm font-bold text-[#06361A]"
      >
        Send on WhatsApp
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        className={`rounded-2xl px-4 text-sm font-bold ${
          tone === "dark" ? "bg-white/10 text-white" : "bg-[#F3F4FB] text-[#1A1B2E]"
        }`}
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}

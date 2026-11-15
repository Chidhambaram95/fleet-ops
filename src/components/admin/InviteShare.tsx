"use client";

import { useState } from "react";
import {
  inviteMessage,
  whatsappDigits,
} from "@domain/companies/types";
import { whatsAppChatUrl } from "@domain/platform/whatsapp";

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
  const waUrl = whatsAppChatUrl(digits, text);

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
        className="inline-flex items-center rounded-lg bg-whatsapp px-4 text-sm font-bold text-white"
      >
        Send on WhatsApp
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        className={`rounded-lg px-4 text-sm font-bold ${
          tone === "dark" ? "bg-surface/10 text-white" : "bg-canvas text-ink"
        }`}
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}

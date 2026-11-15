"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCompanyAction } from "@/app/(admin)/admin/actions";
import { InviteShare } from "@/components/admin/InviteShare";
import {
  BUS_TYPES,
  BUS_TYPE_LABELS,
  type BusType,
} from "@domain/companies/types";

const input =
  "rounded-lg border border-line-strong bg-surface px-3.5 text-base font-normal";

export function AddCompanyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [town, setTown] = useState("");
  const [gstin, setGstin] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminWhatsapp, setAdminWhatsapp] = useState("");
  const [busTypes, setBusTypes] = useState<BusType[]>(["town"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    token: string;
    company: string;
    adminName: string;
    whatsapp: string;
  } | null>(null);

  function toggle(type: BusType) {
    setBusTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function submit() {
    setBusy(true);
    setError("");
    const result = await createCompanyAction({
      name,
      town,
      busTypes,
      gstin,
      adminName,
      adminWhatsapp,
    });
    setBusy(false);
    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }
    setCreated({
      token: result.token as string,
      company: name.trim(),
      adminName: adminName.trim(),
      whatsapp: adminWhatsapp,
    });
    setName("");
    setTown("");
    setGstin("");
    setAdminName("");
    setAdminWhatsapp("");
    setBusTypes(["town"]);
    router.refresh();
  }

  if (created) {
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-brand p-5 text-white">
        <h2 className="text-lg font-semibold">{created.company} is ready</h2>
        <p className="text-sm text-brand-pale">
          Send this invite to {created.adminName || "the admin"}. They create their password and
          become the company admin. The free trial starts now.
        </p>
        <InviteShare
          token={created.token}
          company={created.company}
          name={created.adminName}
          whatsappNumber={created.whatsapp}
          tone="dark"
        />
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setOpen(false);
          }}
          className="self-start text-sm font-semibold text-white underline"
        >
          Done
        </button>
      </section>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-lg bg-brand px-5 text-sm font-semibold text-white"
      >
        Add company
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5"
    >
      <h2 className="text-lg font-semibold">Add company</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Company name
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Town
          <input value={town} onChange={(e) => setTown(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          GSTIN (optional)
          <input value={gstin} onChange={(e) => setGstin(e.target.value)} className={input} />
        </label>
        <fieldset className="flex flex-col gap-1 text-sm font-semibold">
          <legend className="mb-1">Bus types allowed</legend>
          <div className="flex flex-wrap gap-2">
            {BUS_TYPES.map((type) => (
              <label
                key={type}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3.5 text-sm font-semibold ${
                  busTypes.includes(type) ? "bg-brand-soft text-brand-dark" : "bg-canvas"
                }`}
              >
                <input
                  type="checkbox"
                  checked={busTypes.includes(type)}
                  onChange={() => toggle(type)}
                  className="min-h-0"
                />
                {BUS_TYPE_LABELS[type]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Admin&apos;s name
          <input value={adminName} onChange={(e) => setAdminName(e.target.value)} className={input} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Admin&apos;s WhatsApp number
          <input
            value={adminWhatsapp}
            onChange={(e) => setAdminWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="98765 43210"
            className={input}
          />
        </label>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create and get invite"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg bg-canvas px-5 text-sm font-semibold"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

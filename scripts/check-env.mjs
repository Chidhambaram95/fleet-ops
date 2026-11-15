// Checks the environment variables before a build or a deploy.
//
//   node scripts/check-env.mjs            public keys must be set and well formed;
//                                         server keys too when VERCEL_ENV=production
//   node scripts/check-env.mjs --production   always require the server keys
//
// It also checks that .env.example lists the same names as this file, and
// that no browser code can see a server-only key.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const production = process.argv.includes("--production") || process.env.VERCEL_ENV === "production";

/** name -> { server: only on the server, required: "always" | "production" | "never", check } */
const VARIABLES = {
  NEXT_PUBLIC_SUPABASE_URL: {
    required: "always",
    check: (value) =>
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(value.trim().replace(/\/+$/, "")) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value.trim().replace(/\/+$/, ""))
        ? null
        : "must look like https://your-project.supabase.co with nothing after it",
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    required: "always",
    check: (value) =>
      value === process.env.SUPABASE_SERVICE_ROLE_KEY
        ? "is the same as SUPABASE_SERVICE_ROLE_KEY. The service role key must never be public"
        : null,
  },
  NEXT_PUBLIC_MANAGER_PHONE: {
    required: "never",
    check: (value) => (/^\d{11,15}$/.test(value) ? null : "must be digits only, with the country code"),
  },
  GOOGLE_GENERATIVE_AI_API_KEY: { server: true, required: "production" },
  SUPABASE_SERVICE_ROLE_KEY: { server: true, required: "production" },
};

const problems = [];

for (const [name, rule] of Object.entries(VARIABLES)) {
  const value = process.env[name] ?? "";
  const needed = rule.required === "always" || (rule.required === "production" && production);
  if (!value.trim()) {
    if (needed) problems.push(`${name} is not set.`);
    continue;
  }
  const message = rule.check?.(value);
  if (message) problems.push(`${name} ${message}.`);
}

// A server-only key must never carry the public prefix.
for (const name of Object.keys(process.env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|PRIVATE/.test(name)) {
    problems.push(`${name} would be sent to the browser. Remove the NEXT_PUBLIC_ prefix.`);
  }
}

// .env.example and this file list the same names.
const example = readFileSync(join(root, ".env.example"), "utf8")
  .split(/\r?\n/)
  .filter((line) => /^[A-Z0-9_]+=/.test(line))
  .map((line) => line.slice(0, line.indexOf("=")));
for (const name of example) {
  if (!(name in VARIABLES)) problems.push(`.env.example has ${name}, which scripts/check-env.mjs does not know.`);
}
for (const name of Object.keys(VARIABLES)) {
  if (!example.includes(name)) problems.push(`${name} is missing from .env.example.`);
}

// Browser code must not read a server-only key.
const serverOnly = Object.entries(VARIABLES)
  .filter(([, rule]) => rule.server)
  .map(([name]) => name);
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(entry)) {
      const text = readFileSync(path, "utf8");
      if (!/^\s*["']use client["']/.test(text)) continue;
      for (const name of serverOnly) {
        if (text.includes(name)) problems.push(`${path.slice(root.length)} is browser code but reads ${name}.`);
      }
    }
  }
}
walk(join(root, "src"));

if (problems.length) {
  console.error("Environment check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Environment check passed${production ? " (production rules)" : ""}.`);

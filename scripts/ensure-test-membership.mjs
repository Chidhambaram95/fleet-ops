import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).trim()];
    }),
);

const email = "Test@123";
const password = "Test@123";
const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const signIn = await client.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data.user) {
  console.error(signIn.error?.message ?? "Sign in failed.");
  process.exit(1);
}

const userId = signIn.data.user.id;
console.log("auth.uid()", userId);

let membership = await client
  .from("organization_members")
  .select("organization_id, role")
  .eq("user_id", userId)
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();

console.log("organization membership", {
  data: membership.data,
  error: membership.error,
});

if (!membership.data) {
  const ensured = await client.rpc("ensure_personal_organization");
  console.log("dev membership fallback", {
    data: ensured.data,
    error: ensured.error,
  });
  if (ensured.error) {
    console.error(
      `Apply supabase/migrations/0005_dev_personal_organization.sql, or insert a row for ${userId}.`,
    );
    process.exit(1);
  }
  membership = await client
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  console.log("organization membership after fallback", membership.data);
}

import { hasPublicSupabaseEnv } from "@data/supabase/env";
import { AppHeader } from "@/components/layout/AppHeader";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function AppShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!hasPublicSupabaseEnv()) {
    return <main className="mx-auto max-w-md px-4 py-5">{children}</main>;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-dvh">
      <AppHeader email={user?.email ?? ""} />
      <main className="mx-auto max-w-md px-4 py-5">{children}</main>
    </div>
  );
}

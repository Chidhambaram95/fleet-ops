export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand text-lg font-extrabold text-white">
          F
        </span>
        <span className="text-lg font-extrabold">Fleet Ops</span>
      </div>
      {children}
    </main>
  );
}

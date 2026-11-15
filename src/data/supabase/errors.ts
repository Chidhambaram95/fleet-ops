/** Throws the Supabase error message as an Error. Shared by every repository. */
export function throwIfError(error: { message: string; code?: string } | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

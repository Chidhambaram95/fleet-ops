/** Turns a thrown error into a sentence for the screen; database policy text never reaches people. */
export function friendlyErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (!message) return "Something went wrong.";
  if (/view-only/i.test(message)) return "The app is view-only until the payment is received.";
  if (/row-level security/i.test(message)) return "You don't have permission to do this.";
  return message;
}

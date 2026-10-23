/**
 * A login is an email address or a phone number. Supabase signs people in by
 * email, so a phone number becomes a made-up address on a reserved domain that
 * can never receive mail. People only ever type the phone number.
 */
export const PHONE_LOGIN_DOMAIN = "phone.fleetops.invalid";

export const MIN_PASSWORD_LENGTH = 6;

export type LoginId =
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string; email: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads what someone typed in the login box; null when it is neither. */
export function parseLoginId(input: string): LoginId | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!EMAIL.test(email) || email.endsWith(`@${PHONE_LOGIN_DOMAIN}`)) return null;
    return { kind: "email", email };
  }
  if (!/^[+\d\s()-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, "");
  // 098765 43210 or 98765 43210: an Indian mobile number.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return { kind: "phone", phone: digits, email: `p${digits}@${PHONE_LOGIN_DOMAIN}` };
}

export function isPhoneLoginEmail(email: string) {
  return email.toLowerCase().endsWith(`@${PHONE_LOGIN_DOMAIN}`);
}

/** How a stored login reads on screen: the email, or "+91 98765 43210". */
export function loginLabel(email: string) {
  if (!isPhoneLoginEmail(email)) return email;
  const digits = email.slice(1, email.indexOf("@"));
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`;
  }
  return null;
}

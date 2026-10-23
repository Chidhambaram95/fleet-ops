import { describe, expect, it } from "vitest";
import { isPhoneLoginEmail, loginLabel, parseLoginId, passwordProblem } from "@domain/auth/loginId";

describe("parseLoginId", () => {
  it("keeps an email, in lower case", () => {
    expect(parseLoginId("  Ravi@Example.com ")).toEqual({ kind: "email", email: "ravi@example.com" });
  });

  it("turns a 10-digit mobile number into an Indian phone login", () => {
    expect(parseLoginId("98765 43210")).toEqual({
      kind: "phone",
      phone: "919876543210",
      email: "p919876543210@phone.fleetops.invalid",
    });
  });

  it("reads +91, a leading 0 and dashes the same way", () => {
    const expected = parseLoginId("9876543210");
    expect(parseLoginId("+91 98765-43210")).toEqual(expected);
    expect(parseLoginId("09876543210")).toEqual(expected);
  });

  it("refuses text that is neither", () => {
    expect(parseLoginId("")).toBeNull();
    expect(parseLoginId("ravi")).toBeNull();
    expect(parseLoginId("12345")).toBeNull();
    expect(parseLoginId("ravi@")).toBeNull();
  });

  it("never lets anyone type the hidden phone-login address", () => {
    expect(parseLoginId("p919876543210@phone.fleetops.invalid")).toBeNull();
  });
});

describe("loginLabel", () => {
  it("shows a phone login as a phone number", () => {
    expect(loginLabel("p919876543210@phone.fleetops.invalid")).toBe("+91 98765 43210");
    expect(isPhoneLoginEmail("p919876543210@phone.fleetops.invalid")).toBe(true);
  });

  it("leaves an email as it is", () => {
    expect(loginLabel("ravi@example.com")).toBe("ravi@example.com");
    expect(isPhoneLoginEmail("ravi@example.com")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("asks for at least 6 characters", () => {
    expect(passwordProblem("12345")).toMatch(/at least 6/);
    expect(passwordProblem("123456")).toBeNull();
  });
});

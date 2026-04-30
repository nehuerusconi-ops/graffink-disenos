/**
 * Tests for the checkout form's DNI/CUIT gate.
 *
 * The CheckoutDialog calls `isAcceptableDniInput(customerDni)` from its
 * `handleProceedToPayment` handler. If that returns false, the handler
 * surfaces a toast and returns early — meaning no fetch to the backend is
 * fired. These tests pin that gate down so a future refactor cannot
 * silently accept invalid identifiers and let them through to the API.
 *
 * They also test `dniForPayload`, which is what the dialog actually sends
 * in the request body (via `JSON.stringify({ customerDni: dniForPayload(...) })`).
 */

import { describe, it, expect, vi } from "vitest";
import { dniDigits, dniForPayload, isAcceptableDniInput } from "./dniInput";

describe("dniDigits", () => {
  it("strips formatting characters", () => {
    expect(dniDigits("12.345.678")).toBe("12345678");
    expect(dniDigits("20-31345678-9")).toBe("20313456789");
    expect(dniDigits("  1234567 ")).toBe("1234567");
  });

  it("returns empty string when there are no digits", () => {
    expect(dniDigits("")).toBe("");
    expect(dniDigits("abc")).toBe("");
    expect(dniDigits("---")).toBe("");
  });
});

describe("isAcceptableDniInput (the checkout gate)", () => {
  it("accepts an empty value (DNI is optional in checkout)", () => {
    expect(isAcceptableDniInput("")).toBe(true);
    expect(isAcceptableDniInput("   ")).toBe(true);
  });

  it("accepts a 7- or 8-digit DNI", () => {
    expect(isAcceptableDniInput("1234567")).toBe(true);
    expect(isAcceptableDniInput("12345678")).toBe(true);
  });

  it("accepts an 11-digit CUIT (backend re-checks the checksum)", () => {
    expect(isAcceptableDniInput("20313456789")).toBe(true);
  });

  it("accepts values with formatting that resolve to a valid length", () => {
    expect(isAcceptableDniInput("12.345.678")).toBe(true);
    expect(isAcceptableDniInput("20-31345678-9")).toBe(true);
  });

  it("rejects 9- or 10-digit numbers (not a DNI, not a CUIT)", () => {
    expect(isAcceptableDniInput("123456789")).toBe(false);
    expect(isAcceptableDniInput("1234567890")).toBe(false);
  });

  it("rejects values shorter than 7 digits", () => {
    expect(isAcceptableDniInput("123456")).toBe(false);
    expect(isAcceptableDniInput("1")).toBe(false);
  });

  it("rejects values longer than 11 digits", () => {
    expect(isAcceptableDniInput("123456789012")).toBe(false);
  });
});

describe("dniForPayload (request body builder)", () => {
  it("returns undefined when nothing valid was typed", () => {
    expect(dniForPayload("")).toBeUndefined();
    expect(dniForPayload("abc")).toBeUndefined();
    expect(dniForPayload("123")).toBeUndefined();
    expect(dniForPayload("123456789")).toBeUndefined();
  });

  it("returns the digits-only value for a valid DNI/CUIT", () => {
    expect(dniForPayload("1234567")).toBe("1234567");
    expect(dniForPayload("12345678")).toBe("12345678");
    expect(dniForPayload("20-31345678-9")).toBe("20313456789");
    expect(dniForPayload("12.345.678")).toBe("12345678");
  });

  it("works inside JSON.stringify exactly like the dialog does", () => {
    const body = JSON.stringify({
      customerName: "Test",
      customerDni: dniForPayload("12.345.678"),
    });
    expect(JSON.parse(body)).toEqual({
      customerName: "Test",
      customerDni: "12345678",
    });
  });

  it("omits the customerDni key entirely when the input is invalid", () => {
    const body = JSON.parse(
      JSON.stringify({
        customerName: "Test",
        customerDni: dniForPayload("123456789"), // 9 digits — invalid
      }),
    );
    expect(body).toEqual({ customerName: "Test" });
  });
});

describe("checkout flow simulation", () => {
  /**
   * Mirrors what handleProceedToPayment does for the DNI gate:
   *   - if isAcceptableDniInput(...) returns false → toast + return early
   *   - otherwise advance to the payment step
   * The toast and step-setter are stubs here; this test asserts they are
   * called the way the real component calls them.
   */
  function attemptToProceed(customerDni: string) {
    const toast = vi.fn();
    const setStep = vi.fn();
    if (!isAcceptableDniInput(customerDni)) {
      toast("Ingresá un DNI (7-8 dígitos) o CUIT (11 dígitos)");
      return { advanced: false, toast, setStep };
    }
    setStep("payment");
    return { advanced: true, toast, setStep };
  }

  it("does NOT advance to payment when DNI has 9 digits", () => {
    const { advanced, toast, setStep } = attemptToProceed("123456789");
    expect(advanced).toBe(false);
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      "Ingresá un DNI (7-8 dígitos) o CUIT (11 dígitos)",
    );
    expect(setStep).not.toHaveBeenCalled();
  });

  it("does NOT advance to payment when DNI has 10 digits", () => {
    const { advanced, toast, setStep } = attemptToProceed("1234567890");
    expect(advanced).toBe(false);
    expect(toast).toHaveBeenCalledOnce();
    expect(setStep).not.toHaveBeenCalled();
  });

  it("advances to payment when DNI is valid (8 digits)", () => {
    const { advanced, toast, setStep } = attemptToProceed("12345678");
    expect(advanced).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    expect(setStep).toHaveBeenCalledWith("payment");
  });

  it("advances to payment when CUIT is 11 digits", () => {
    const { advanced } = attemptToProceed("20313456789");
    expect(advanced).toBe(true);
  });

  it("advances to payment when DNI is left empty (optional field)", () => {
    const { advanced } = attemptToProceed("");
    expect(advanced).toBe(true);
  });
});

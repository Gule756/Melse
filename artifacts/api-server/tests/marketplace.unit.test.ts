import { describe, expect, it } from "vitest";
import { canTransition } from "../src/lib/job-state";
import { calculateEstimate, resolveProviderPrice } from "../src/lib/pricing";

describe("provider price resolution", () => {
  it("uses configured fixed price and enforces a minimum charge", () => {
    expect(resolveProviderPrice({
      pricingModel: "FIXED",
      amount: "350.00",
      minimumCharge: "400.00",
    }, 500)).toEqual({ price: 400 });
  });

  it("requires a provider quote for hourly and quote-based services", () => {
    expect(resolveProviderPrice({ pricingModel: "HOURLY", amount: "450", minimumCharge: null }, undefined))
      .toHaveProperty("error");
    expect(resolveProviderPrice({ pricingModel: "QUOTE", amount: null, minimumCharge: null }, 750))
      .toEqual({ price: 750 });
  });

  it("rejects non-finite and below-minimum quotes", () => {
    expect(resolveProviderPrice({ pricingModel: "QUOTE", amount: null, minimumCharge: "200" }, Number.NaN))
      .toHaveProperty("error");
    expect(resolveProviderPrice({ pricingModel: "QUOTE", amount: null, minimumCharge: "200" }, 150))
      .toHaveProperty("error");
  });
});

describe("price estimates", () => {
  it("applies configured customer, emergency, distance, and material fees", () => {
    expect(calculateEstimate({
      baseMin: 100,
      baseMax: 200,
      emergencyFee: 50,
      commissionRate: 0.1,
      customerFee: 10,
      includedDistanceKm: 5,
      perKmRate: 20,
    }, {
      isEmergency: true,
      distanceKm: 7,
      additionalMaterialsFee: 30,
    })).toMatchObject({
      minPrice: 230,
      maxPrice: 330,
      emergencyFee: 50,
      customerFee: 10,
      distanceFee: 40,
      platformCommission: 23,
      currency: "ETB",
    });
  });
});

describe("booking state transitions", () => {
  it("allows the intended lifecycle but not payment through generic status changes", () => {
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransition("COMPLETED", "CUSTOMER_CONFIRMED")).toBe(true);
    expect(canTransition("CUSTOMER_CONFIRMED", "PAID")).toBe(true);
    expect(canTransition("ACCEPTED", "PAID")).toBe(false);
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
  });
});

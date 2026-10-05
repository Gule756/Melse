export type PricingRules = {
  baseMin: number;
  baseMax: number;
  emergencyFee: number;
  commissionRate: number;
  customerFee?: number;
  includedDistanceKm?: number;
  perKmRate?: number;
};

export type PriceCalculationParams = {
  isEmergency: boolean;
  distanceKm: number;
  additionalMaterialsFee?: number;
};

export type ProviderPricing = {
  pricingModel: "FIXED" | "HOURLY" | "QUOTE";
  amount: string | null;
  minimumCharge: string | null;
};

export function resolveProviderPrice(pricing: ProviderPricing | undefined, quotedPrice: number | undefined) {
  if (!pricing) return { error: "Provider pricing is not configured for this service." } as const;
  const minimumCharge = pricing.minimumCharge === null ? 0 : Number(pricing.minimumCharge);
  const price = pricing.pricingModel === "FIXED"
    ? pricing.amount === null ? undefined : Math.max(Number(pricing.amount), minimumCharge)
    : quotedPrice;
  if (price === undefined || !Number.isFinite(price) || price <= 0) {
    return { error: pricing.pricingModel === "FIXED"
      ? "Fixed provider pricing is not configured."
      : "The provider must submit a positive total price for this service." } as const;
  }
  if (price < minimumCharge) return { error: "The price is below the provider's minimum charge." } as const;
  return { price } as const;
}

export function calculateEstimate(rules: PricingRules, params: PriceCalculationParams) {
  const includedDistanceKm = rules.includedDistanceKm ?? 5;
  const distanceFee = params.distanceKm > includedDistanceKm
    ? (params.distanceKm - includedDistanceKm) * (rules.perKmRate ?? 30)
    : 0;
  const emergencyFee = params.isEmergency ? rules.emergencyFee : 0;
  const customerFee = rules.customerFee ?? 0;
  const materialsFee = params.additionalMaterialsFee ?? 0;
  const minPrice = rules.baseMin + emergencyFee + distanceFee + customerFee + materialsFee;
  const maxPrice = rules.baseMax + emergencyFee + distanceFee + customerFee + materialsFee;
  return {
    minPrice,
    maxPrice,
    baseMin: rules.baseMin,
    baseMax: rules.baseMax,
    emergencyFee,
    customerFee,
    distanceFee,
    platformCommission: Math.round(minPrice * rules.commissionRate),
    currency: "ETB" as const,
  };
}
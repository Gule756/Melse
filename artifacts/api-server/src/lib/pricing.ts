export type PricingRules = {
  baseMin: number;
  baseMax: number;
  emergencyFee: number;
  commissionRate: number;
};

export type PriceCalculationParams = {
  isEmergency: boolean;
  distanceKm: number;
  additionalMaterialsFee?: number;
};

export function calculateEstimate(rules: PricingRules, params: PriceCalculationParams) {
  const distanceFee = params.distanceKm > 5 ? (params.distanceKm - 5) * 30 : 0;
  const emergencyFee = params.isEmergency ? rules.emergencyFee : 0;
  const materialsFee = params.additionalMaterialsFee ?? 0;
  const minPrice = rules.baseMin + emergencyFee + distanceFee + materialsFee;
  const maxPrice = rules.baseMax + emergencyFee + distanceFee + materialsFee;
  return {
    minPrice,
    maxPrice,
    baseMin: rules.baseMin,
    baseMax: rules.baseMax,
    emergencyFee,
    distanceFee,
    platformCommission: Math.round(minPrice * rules.commissionRate),
    currency: "ETB" as const,
  };
}
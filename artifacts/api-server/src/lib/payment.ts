export type PaymentInitiation = {
  bookingId: string;
  amount: number;
  currency: "ETB";
  phoneNumber: string;
  returnUrl: string;
};

export type PaymentResponse = {
  transactionId: string;
  redirectUrl?: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
};

export interface PaymentProvider {
  readonly name: string;
  initiatePayment(payload: PaymentInitiation): Promise<PaymentResponse>;
  verifyPayment(transactionId: string): Promise<boolean>;
  processRefund(bookingId: string, amount: number): Promise<boolean>;
}

/**
 * Safe development adapter. It deliberately never reports payment success;
 * a regional provider must be connected before checkout can be enabled.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = "unconfigured";

  async initiatePayment(_payload: PaymentInitiation): Promise<PaymentResponse> {
    return { transactionId: `PENDING-${Date.now()}`, status: "PENDING" };
  }

  async verifyPayment(_transactionId: string) {
    return false;
  }

  async processRefund(_bookingId: string, _amount: number) {
    return false;
  }
}
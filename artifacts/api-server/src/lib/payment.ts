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

export class ChapaPaymentProvider implements PaymentProvider {
  readonly name = "chapa";
  private readonly secretKey = process.env.CHAPA_SECRET_KEY;

  async initiatePayment(payload: PaymentInitiation): Promise<PaymentResponse> {
    if (!this.secretKey) return { transactionId: `CHAPA-CONFIG-REQUIRED-${Date.now()}`, status: "PENDING" };
    const response = await fetch("https://api.chapa.co/v1/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ amount: payload.amount, currency: payload.currency, tx_ref: payload.bookingId, phone_number: payload.phoneNumber, return_url: payload.returnUrl }) });
    if (!response.ok) return { transactionId: `CHAPA-FAILED-${Date.now()}`, status: "FAILED" };
    const body = await response.json() as { data?: { tx_ref?: string; checkout_url?: string } };
    return { transactionId: body.data?.tx_ref ?? payload.bookingId, redirectUrl: body.data?.checkout_url, status: "PENDING" };
  }

  async verifyPayment(transactionId: string) {
    if (!this.secretKey) return false;
    const response = await fetch(`https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(transactionId)}`, { headers: { Authorization: `Bearer ${this.secretKey}` } });
    if (!response.ok) return false;
    const body = await response.json() as { data?: { status?: string } };
    return body.data?.status === "success";
  }

  async processRefund(_bookingId: string, _amount: number) { return false; }
}
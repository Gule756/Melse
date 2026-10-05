import { randomUUID } from "node:crypto";

export type PaymentInitiation = {
  bookingId: string;
  amount: number;
  currency: "ETB";
  phoneNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  returnUrl: string;
};

export type PaymentResponse = {
  transactionId: string;
  redirectUrl?: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
};

export type PaymentVerification = {
  transactionId: string;
  amount: string;
  currency: string;
};

export interface PaymentProvider {
  readonly name: string;
  initiatePayment(payload: PaymentInitiation): Promise<PaymentResponse>;
  verifyPayment(transactionId: string): Promise<PaymentVerification | null>;
  processRefund(bookingId: string, amount: number): Promise<boolean>;
}

export class PaymentProviderUnavailableError extends Error {}
export class PaymentProviderRequestError extends Error {}

export class ChapaPaymentProvider implements PaymentProvider {
  readonly name = "chapa";
  private readonly secretKey = process.env.CHAPA_SECRET_KEY;
  private readonly apiBaseUrl = (process.env.CHAPA_API_BASE_URL ?? "https://api.chapa.co/v1").replace(/\/$/, "");

  private requireSecret() {
    if (!this.secretKey) throw new PaymentProviderUnavailableError("Chapa payments are not configured.");
    return this.secretKey;
  }

  private async request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new PaymentProviderRequestError("Could not reach the payment provider.");
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !body || typeof body !== "object") {
      throw new PaymentProviderRequestError(`Payment provider request failed with status ${response.status}.`);
    }
    return body as Record<string, unknown>;
  }

  async initiatePayment(payload: PaymentInitiation): Promise<PaymentResponse> {
    const txRef = `melse-${payload.bookingId}-${randomUUID()}`;
    const body = await this.request(`${this.apiBaseUrl}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.requireSecret()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: payload.amount.toFixed(2),
        currency: payload.currency,
        email: payload.email,
        first_name: payload.firstName,
        last_name: payload.lastName,
        phone_number: payload.phoneNumber,
        tx_ref: txRef,
        return_url: payload.returnUrl,
        customization: { title: "Melse service", description: `Payment for booking ${payload.bookingId}` },
      }),
    });
    const data = body.data;
    if (body.status !== "success" || !data || typeof data !== "object") {
      throw new PaymentProviderRequestError("Chapa did not initialize the payment.");
    }
    const responseData = data as Record<string, unknown>;
    if (typeof responseData.checkout_url !== "string" || typeof responseData.tx_ref !== "string") {
      throw new PaymentProviderRequestError("Chapa returned an incomplete payment initialization response.");
    }
    return { transactionId: responseData.tx_ref, redirectUrl: responseData.checkout_url, status: "PENDING" };
  }

  async verifyPayment(transactionId: string): Promise<PaymentVerification | null> {
    const body = await this.request(`${this.apiBaseUrl}/transaction/verify/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.requireSecret()}` },
    });
    if (body.status !== "success" || !body.data || typeof body.data !== "object") return null;
    const data = body.data as Record<string, unknown>;
    if (data.status !== "success") return null;
    if (typeof data.tx_ref !== "string" || (typeof data.amount !== "string" && typeof data.amount !== "number") || typeof data.currency !== "string") {
      throw new PaymentProviderRequestError("Chapa returned incomplete payment verification details.");
    }
    const amount = String(data.amount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      throw new PaymentProviderRequestError("Chapa returned an invalid verified payment amount.");
    }
    return { transactionId: data.tx_ref, amount, currency: data.currency };
  }

  async processRefund(_bookingId: string, _amount: number): Promise<boolean> {
    throw new PaymentProviderUnavailableError("Chapa refunds require a configured and verified refund workflow.");
  }
}
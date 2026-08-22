import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppEnv, type AppEnv } from "../env.js";

export interface ChapaInitParams {
  txRef: string;
  amountHalala: number;
  firstName: string;
  lastName: string | null;
  phone: string;
  orderId: string;
  orderNo: string;
  shopName: string;
}

export interface ChapaClient {
  initializeTransaction: (params: ChapaInitParams) => Promise<string>;
}

export function chapaBaseUrl(env: AppEnv): string {
  return (env.CHAPA_BASE_URL ?? "https://api.chapa.co/v1").replace(/\/$/, "");
}

export function requireChapaSecretKey(env: AppEnv): string {
  const key = env.CHAPA_SECRET_KEY;
  if (!key) {
    throw new Error("CHAPA_SECRET_KEY is not configured on the server");
  }
  return key;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || "Customer";
  const lastName = parts.slice(1).join(" ") || "-";
  return { firstName, lastName };
}

export async function verifyTransaction(
  env: AppEnv,
  txRef: string,
): Promise<{ status: string; amount: number | null; reference: string | null }> {
  const secret = requireChapaSecretKey(env);
  const res = await fetch(`${chapaBaseUrl(env)}/transaction/verify/${encodeURIComponent(txRef)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    throw new Error(`chapa verify failed (${res.status})`);
  }
  const json = (await res.json()) as {
    status?: string;
    data?: { status?: string; amount?: number | string; reference?: string };
  };
  const data = json.data ?? {};
  return {
    status: String(data.status ?? json.status ?? "unknown"),
    amount: data.amount != null ? Number(data.amount) : null,
    reference: data.reference ?? null,
  };
}

export function createChapaClient(env: AppEnv): ChapaClient {
  return {
    async initializeTransaction(params: ChapaInitParams): Promise<string> {
      const secret = requireChapaSecretKey(env);
      const { firstName, lastName } = splitName(params.firstName || params.shopName);
      const email = `${params.txRef.replace(/[^a-z0-9]/gi, "").slice(0, 20).toLowerCase()}@sabacos.app`;
      const webhookUrl = `${env.WEBHOOK_URL?.replace(/\/$/, "") ?? ""}/api/v1/webhooks/chapa`;

      const body = {
        amount: (params.amountHalala / 100).toFixed(2),
        currency: "ETB",
        email,
        first_name: firstName,
        last_name: lastName,
        phone: params.phone,
        tx_ref: params.txRef,
        return_url: `${env.WEBAPP_URL.replace(/\/$/, "")}/orders/${params.orderId}`,
        ...(webhookUrl.startsWith("https") ? { callback_url: webhookUrl } : {}),
        customization: {
          title: params.shopName,
          description: `Order ${params.orderNo}`,
        },
      };

      const res = await fetch(`${chapaBaseUrl(env)}/transaction/initialize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => null)) as
        | { status?: string; message?: string; data?: { checkout_url?: string; data?: { checkout_url?: string } } }
        | null;

      const checkoutUrl =
        json?.data?.checkout_url ??
        (json?.data as unknown as { data?: { checkout_url?: string } } | undefined)?.data?.checkout_url;

      if (!res.ok || !json || !checkoutUrl) {
        throw new Error(`chapa init failed (${res.status}): ${json?.message ?? "no checkout_url"}`);
      }
      return checkoutUrl;
    },
  };
}

export function verifyChapaSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const secret = requireChapaSecretKey(getAppEnv());
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader.toLowerCase());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

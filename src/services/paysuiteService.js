import fetch from "node-fetch";

const PAYSUITE_API_URL = "https://paysuite.tech/api/v1";

/**
 * Cria uma cobrança na PaySuite (e-Mola).
 * Devolve um `checkoutUrl` onde o cliente deve confirmar.
 */
export async function createPaySuiteCharge(amountMZN, referenceId) {
  const apiToken = process.env.PAYSUITE_API_TOKEN;
  if (!apiToken) {
    throw new Error("Credenciais da PaySuite em falta no .env (PAYSUITE_API_TOKEN)");
  }

  const payload = {
    amount: Number(amountMZN),
    method: "emola",
    reference: `licenca_${referenceId}`
  };

  const response = await fetch(`${PAYSUITE_API_URL}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.message || data?.error || `PaySuite respondeu com estado ${response.status}`;
    throw new Error(String(message));
  }

  const charge = data?.data ?? {};

  return {
    id: String(charge.id ?? ""),
    status: String(charge.status ?? "pending"),
    amount: Number(charge.amount ?? amountMZN),
    reference: charge.reference || payload.reference,
    checkoutUrl: charge.checkout_url || undefined
  };
}

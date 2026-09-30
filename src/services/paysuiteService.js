const PAYSUITE_API_URL = "https://paysuite.tech/api/v1";

/**
 * A PaySuite guarda cada `reference` para sempre, mesmo que o pedido seja
 * cancelado, e recusa repetições ("The Reference has already been taken").
 * Como o id da tabela pode ser reutilizado (ex.: depois de uma eliminação
 * em teste), juntamos um sufixo único para nunca colidir.
 */
function referenciaUnica(referenceId) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "LIC" + String(referenceId) + stamp + rand;
}

/**
 * Cria um pedido de pagamento na PaySuite e devolve a página de checkout.
 *
 * Sem `method`, a página de checkout deixa o cliente escolher entre
 * e-Mola, M-Pesa e cartão — é o cliente que decide como paga.
 *
 * A `reference` só pode ter letras e números (a PaySuite recusa "_" e "-"),
 * por isso o prefixo é "LIC" sem separador.
 */
export async function createPaySuiteCharge(amountMZN, referenceId, opts = {}) {
  const apiToken = process.env.PAYSUITE_API_TOKEN;
  if (!apiToken) {
    throw new Error("Credenciais da PaySuite em falta no ambiente (PAYSUITE_API_TOKEN)");
  }

  const payload = {
    amount: Number(amountMZN),
    reference: referenciaUnica(referenceId),
    description: String(opts.description || "Licenca " + referenceId).slice(0, 125),
  };
  if (opts.method) payload.method = opts.method;
  if (opts.webhookUrl) payload.webhook_url = opts.webhookUrl;
  if (opts.returnUrl) payload.return_url = opts.returnUrl;

  const response = await fetch(PAYSUITE_API_URL + "/payments", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) || "PaySuite respondeu com estado " + response.status;
    throw new Error(String(message));
  }

  const charge = (data && data.data) || {};

  return {
    id: String(charge.id == null ? "" : charge.id),
    status: String(charge.status || "pending"),
    amount: Number(charge.amount == null ? amountMZN : charge.amount),
    reference: charge.reference || payload.reference,
    checkoutUrl: charge.checkout_url || undefined,
  };
}

/** Consulta o estado de um pedido de pagamento (para confirmar/reconciliar). */
export async function getPaySuiteCharge(paymentId) {
  const apiToken = process.env.PAYSUITE_API_TOKEN;
  if (!apiToken) throw new Error("Credenciais da PaySuite em falta (PAYSUITE_API_TOKEN)");

  const response = await fetch(PAYSUITE_API_URL + "/payments/" + paymentId, {
    headers: { Authorization: "Bearer " + apiToken, Accept: "application/json" },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && data.message) || "PaySuite respondeu com estado " + response.status);
  }
  return (data && data.data) || {};
}

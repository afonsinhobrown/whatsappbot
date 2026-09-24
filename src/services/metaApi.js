import { env, isMetaConfigured } from "../config/env.js";

const GRAPH_API_VERSION = "v20.0";

/**
 * Envia uma mensagem de texto simples para um número de WhatsApp.
 * Em modo MOCK (sem tokens) apenas imprime no console — útil para testes locais.
 */
export async function sendTextMessage(to, text) {
  const formattedTo = formatTo(to);

  if (!isMetaConfigured()) {
    console.log(`[MOCK] Para ${formattedTo}: ${text}`);
    return { mock: true, to: formattedTo, text };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formattedTo,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Meta API ${response.status}: ${detail}`);
  }

  return response.json();
}

/**
 * A API da Meta espera apenas dígitos, com código de país e sem "+".
 * Números moçambicanos sem código recebem 258 por defeito.
 */
function formatTo(to) {
  let digits = String(to || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `258${digits}`;
  return digits;
}

import { env, isMetaConfigured } from "../config/env.js";
import { Buffer } from "node:buffer";

const GRAPH_API_VERSION = "v20.0";

/**
 * Envia uma mensagem de texto para um número de WhatsApp.
 * Usa as credenciais do tenant (token + phone_number_id) quando fornecidas;
 * caso contrário, as do ambiente. Em modo MOCK (sem credenciais) imprime no console.
 */
export async function sendTextMessage(to, text, tenant) {
  const formattedTo = formatTo(to);
  const token = (tenant && tenant.token) || env.whatsappToken;
  const phoneNumberId = (tenant && tenant.phone_number_id) || env.phoneNumberId;

  if (!token || !phoneNumberId) {
    console.log(`[MOCK] Para ${formattedTo}: ${text}`);
    return { mock: true, to: formattedTo, text };
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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

    // 190/463 = token expirado ou inválido. É a falha mais comum e
    // ataca em silêncio, por isso merece uma mensagem explícita.
    if (detail.includes('"code":190') || detail.includes('"code": 190')) {
      throw new Error(
        "TOKEN DA META EXPIRADO/INVÁLIDO (erro 190) — o bot não consegue enviar. " +
          "Gera um token novo em Meta for Developers > WhatsApp > API Setup e " +
          "actualiza WHATSAPP_TOKEN no Vercel. Detalhe: " + detail
      );
    }

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

/**
 * Faz download de ficheiros media (voz, imagem, pdf) enviados pelos utilizadores.
 */
export async function downloadMedia(mediaId, tenant) {
  const token = (tenant && tenant.token) || env.whatsappToken;
  if (!token) throw new Error("No token for downloading media");

  // Passo 1: Pedir o URL do ficheiro
  const infoUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;
  const infoRes = await fetch(infoUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!infoRes.ok) {
    throw new Error(`Failed to get media info: ${await infoRes.text()}`);
  }
  const info = await infoRes.json();
  if (!info.url) throw new Error("Media URL not found in response");

  // Passo 2: Fazer download binário usando o URL
  const mediaRes = await fetch(info.url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!mediaRes.ok) {
    throw new Error(`Failed to download media bytes: ${await mediaRes.text()}`);
  }
  
  const buffer = await mediaRes.arrayBuffer();
  return {
    mimeType: info.mime_type,
    data: Buffer.from(buffer).toString("base64") // Base64 pronto para Gemini
  };
}

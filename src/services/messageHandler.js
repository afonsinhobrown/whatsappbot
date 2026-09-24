import { sendTextMessage } from "./metaApi.js";
import { normalizePhone } from "./dbService.js";
import { handleFAQ, handleFalarComAtendente } from "../flows/atendimento.js";
import { handleConsultaDados } from "../flows/consultaDados.js";

const MENU = [
  "🙂 Olá! Eu sou o assistente TECNOINCUBADORA.",
  "",
  "Escolha uma opção:",
  "1️⃣ Consultar dados (saldo)",
  "2️⃣ Falar com atendente",
  "3️⃣ FAQ",
  "",
  "Ou escreva a sua pergunta.",
].join("\n");

/**
 * Ponto de entrada para cada mensagem de texto recebida no webhook.
 * Identifica a intenção e chama o fluxo correspondente.
 */
export async function handleIncomingMessage(message, changeValue) {
  const phone = normalizePhone(message.from);
  const text = (message.text && message.text.body || "").trim();
  const senderName =
    (changeValue.contacts && changeValue.contacts[0] && changeValue.contacts[0].profile &&
      changeValue.contacts[0].profile.name) ||
    "cliente";

  console.log(`[MSG] ${senderName} (${phone}): "${text}"`);

  // "send" envia a resposta para o mesmo número de onde veio a mensagem
  const send = (reply) => sendTextMessage(phone, reply);

  const lower = text.toLowerCase();

  // Comandos de menu
  if (["menu", "iniciar", "começar", "ola", "olá", "oi", "hey", "0"].includes(lower)) {
    return send(MENU);
  }

  if (lower === "1" || lower.includes("saldo") || lower.includes("saldo é")) {
    return handleConsultaDados(text, phone, send);
  }

  if (lower === "2" || lower.includes("atendente") || lower.includes("humano")) {
    return handleFalarComAtendente(phone);
  }

  if (lower === "3" || lower.includes("faq") || lower.includes("dúvida") || lower.includes("ajuda")) {
    return send(
      "Perguntas frequentes:\n" +
        "· \"esqueci a senha\" → recuperação de senha\n" +
        "· \"como pagar\" → instruções de pagamento\n" +
        "· \"horário\" → horário de atendimento\n\n" +
        "Digite \"menu\" para voltar às opções."
    );
  }

  // FAQ por palavras-chave
  const faqAnswer = handleFAQ(text);
  if (faqAnswer) {
    return send(faqAnswer);
  }

  // Nada correspondeu → mostra o menu
  return send(
    `Olá ${senderName}!\n` +
      "Ainda não entendi o seu pedido. 😅\n\n" +
      MENU
  );
}
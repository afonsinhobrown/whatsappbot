import { getClientByPhone, normalizePhone } from "../services/dbService.js";

function formatMoney(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return `${number.toFixed(2)} MZN`;
}

/**
 * Fluxo de consulta de dados.
 * O cliente pede o saldo; o bot consulta a base de dados e responde.
 */
export async function handleConsultaDados(incomingText, phone, send) {
  const client = await getClientByPhone(phone);

  if (!client) {
    await send(
      "Não encontrei o seu registo na base de dados.\n\n" +
        "Se está a testar, use um dos números DEMO:\n" +
        "· 840000001 → Ana (CredHubMZ)\n" +
        "· 840000002 → Carlos (Xonguile)\n" +
        "· 840000003 → Marta (Gymar)\n\n" +
        "Dica: teste a partir de um número real do WhatsApp e depois ajuste os registos."
    );
    return;
  }

  const saldo = formatMoney(client.balance);

  // Distingue pedido simples vs. avançado
  if ((incomingText || "").toLowerCase().includes("ou perto")) {
    await send(
      `Olá ${client.name}!\n` +
        `Produto: ${client.product}\n` +
        `Saldo atual: ${saldo}`
    );
  } else {
    await send(
      `Olá ${client.name}! 👋\n` +
        `Consultando os nossos sistemas...\n\n` +
        `📦 Produto: ${client.product}\n` +
        `💰 Saldo atual: ${saldo}\n\n` +
        `Responda:\n` +
        `· "1" para voltar ao menu\n` +
        `· "2" para falar com atendente`
    );
  }
}

// Re-export útil para outros módulos
export { normalizePhone };
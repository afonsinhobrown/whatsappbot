import { sendTextMessage } from "../services/metaApi.js";

/**
 * Fluxo de notificações transacionais (envio automático).
 * Não é acionado por mensagem do cliente — é importado por outros
 * serviços (ex.: confirmação de pagamento, lembretes).
 *
 * Exemplo de uso noutro ficheiro:
 *   import { sendNotification } from "./notificacoes.js";
 *   await sendNotification("258840000001", "Pagamento confirmado!");
 */
export async function sendNotification(phone, text) {
  return sendTextMessage(phone, text);
}
import { setSession } from "../services/sessionService.js";
import { sendTextMessage } from "../services/metaApi.js";

/** Opção 5 do menu — marca a sessão como aguardando humano e registra o pedido. */
export async function falarComHumano(client, send, tenant) {
  await setSession(client.id, "humano", { desde: new Date().toISOString() });
  console.log(`[ADMIN] ${client.whatsapp_number} pediu atendimento humano`);

  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER || "";
  if (adminPhone) {
    await sendTextMessage(adminPhone, `🚨 *Novo pedido de atendimento!* 🚨\nCliente: ${client.nome || "Desconhecido"}\nNúmero: ${client.whatsapp_number}\n\n_Para responder, escreva: !responder ${client.whatsapp_number} a sua mensagem_`, tenant);
  }

  return send(
    "👤 Pedido registado! Um agente vai responder em breve.\n\n" +
      'Escreva "menu" para voltar às opções a qualquer momento.'
  );
}

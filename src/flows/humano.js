import { setSession } from "../services/sessionService.js";

/** Opção 5 do menu — marca a sessão como aguardando humano e registra o pedido. */
export async function falarComHumano(client, send) {
  await setSession(client.id, "humano", { desde: new Date().toISOString() });
  console.log(`[ADMIN] ${client.whatsapp_number} pediu atendimento humano`);

  return send(
    "👤 Pedido registado! Um agente vai responder em horário de expediente (Seg–Sex, 8h–17h).\n\n" +
      'Escreva "menu" para voltar às opções.'
  );
}

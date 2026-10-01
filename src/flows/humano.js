import { setSession } from "../services/sessionService.js";
import { sendTextMessage } from "../services/metaApi.js";
import { env } from "../config/env.js";

/**
 * Opção 5 do menu — marca a sessão como aguardando humano e registra o pedido.
 */
export async function falarComHumano(client, send, tenant) {
  await setSession(client.id, "humano", { desde: new Date().toISOString() });
  console.log(`[ADMIN] ${client.whatsapp_number} pediu atendimento humano`);

  // O aviso ao dono é secundário. Se o número estiver errado, o token expirado
  // ou a Meta recusar, não pode ser a razão de o cliente ficar sem resposta:
  // sem este try/catch a excepção saía daqui e o "pedido registado" nunca
  // chegava ao cliente — que era exactamente o que acontecia.
  const numeros = [process.env.ADMIN_WHATSAPP_NUMBER, ...env.adminNumbers].filter(
    (n) => n && !/^\[|SENSITIVE/i.test(n)
  );
  const unicos = [...new Set(numeros.map((n) => String(n).replace(/\D/g, "")))].filter(Boolean);

  if (unicos.length) {
    for (const numero of unicos) {
      try {
        await sendTextMessage(
          numero,
          `🚨 *Novo pedido de atendimento!* 🚨\nCliente: ${client.nome || "Desconhecido"}\nNúmero: ${client.whatsapp_number}\n\n_Para responder, escreva: !responder ${client.whatsapp_number} a sua mensagem_`,
          tenant
        );
      } catch (err) {
        console.error(`[ADMIN] não consegui avisar ${numero}: ${err.message}`);
      }
    }
  } else {
    console.error("[ADMIN] nenhum número de administrador configurado (ADMIN_WHATSAPP_NUMBER / ADMIN_NUMBERS)");
  }

  // A resposta ao cliente vem sempre, mesmo sem ninguém avisado.
  return send(
    "👤 Pedido registado! Um agente vai responder em breve.\n\n" +
      'Escreva "menu" para voltar às opções a qualquer momento.'
  );
}

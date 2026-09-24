import { sendTextMessage } from "../services/metaApi.js";

const FAQ = [
  {
    keywords: ["senha", "password", "palavra-passe", "esqueci"],
    answer:
      "Para recuperar a sua senha: abra a aplicação e toque em \"Esqueci a senha\". O link de redefinição chega por SMS/email.",
  },
  {
    keywords: ["pagamento", "pagar", "deposito", "depósito", "recarga"],
    answer:
      "Os pagamentos são confirmados automaticamente. Após o depósito, receberá uma notificação de confirmação aqui no WhatsApp.",
  },
  {
    keywords: ["horario", "horário", "funcionam", "funcionamento"],
    answer:
      "O atendimento humano funciona de Segunda a Sexta, das 8h às 17h. Fora desse período, o bot responde automaticamente.",
  },
];

/**
 * Fluxo de atendimento/FAQ: procura por palavras-chave e devolve resposta.
 * Retorna null se não encontrar nenhuma correspondência.
 */
export function handleFAQ(text) {
  const lower = (text || "").toLowerCase();

  for (const item of FAQ) {
    if (item.keywords.some((keyword) => lower.includes(keyword))) {
      return item.answer;
    }
  }

  return null;
}

/**
 * "Falar com atendente": em produção isto dispararia uma notificação
 * para a equipa. Aqui apenas registamos no console.
 */
export async function handleFalarComAtendente(phone) {
  console.log(`[ATENDENTE] Pedido de atendimento humano de ${phone}`);
  await sendTextMessage(
    phone,
    "Notámos o seu pedido de atendimento humano.\n\n" +
      "Um agente entrará em contacto em horário de expediente (Seg–Sex, 8h–17h). " +
      "Se for urgente, responda com a palavra SALDO que eu ajudo já."
  );
  return true;
}
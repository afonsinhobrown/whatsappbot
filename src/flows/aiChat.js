import { askAI, classifyIntent } from "../services/aiService.js";
import { getSession, setSession } from "../services/sessionService.js";

/**
 * Número máximo de trocas de conversa guardadas na sessão.
 * Cada "troca" = 1 mensagem do cliente + 1 resposta da IA.
 * Mantemos as últimas 5 para dar contexto sem explodir os tokens.
 */
const MAX_HISTORY_TURNS = 5;

/**
 * Fluxo de conversa livre com IA.
 *
 * Mantém o histórico da sessão para que a IA tenha contexto das últimas
 * mensagens. Classifica a intenção para detectar quando o cliente quer
 * passar para um fluxo específico (cotação, pagamento, etc.).
 *
 * @param {object} client  - Registo do cliente (da tabela clientes)
 * @param {string} text    - Mensagem enviada pelo cliente
 * @param {Function} send  - Função de envio (phone já ligado)
 * @param {object} tenant  - Tenant actual
 */
export async function handleAiMessage(client, text, send, tenant) {
  try {
    // 1. Recuperar histórico da sessão
    const session = await getSession(tenant.id, client.id);
    const ctx = session.contexto || {};
    const history = ctx.ai_history || [];

    // 2. Classificar intenção — pode redirigir para fluxo dedicado
    const { intent } = await classifyIntent(text).catch(() => ({ intent: "outro" }));

    // Intenções com fluxo dedicado → avisa e sugere o comando
    if (intent === "cotacao") {
      return send(
        `Percebi que queres fazer uma cotação! 📋\n\nEscreve *1* e arranjo tudo para ti.`
      );
    }
    if (intent === "pagamento" || intent === "cobranca") {
      return send(
        `Para tratar de pagamentos e licenças, escreve *3* e sigo contigo. 💳`
      );
    }
    if (intent === "agendamento") {
      return send(
        `Queres marcar uma reunião ou demonstração? Escreve *5* para falar com a nossa equipa. 📅`
      );
    }

    // 3. Responder com IA (conversa livre)
    const reply = await askAI(text, history, tenant);

    // 4. Actualizar histórico (mantém últimas MAX_HISTORY_TURNS trocas)
    const updatedHistory = [
      ...history,
      { role: "user", content: text },
      { role: "assistant", content: reply },
    ].slice(-(MAX_HISTORY_TURNS * 2));

    await setSession(client.id, "menu", { ai_history: updatedHistory });

    return send(reply);
  } catch (err) {
    console.error("[AI] Erro no handleAiMessage:", err.message);
    // Falha silenciosa — nunca deixar o cliente sem resposta
    return send(
      `Não entendi bem o teu pedido. 🤔\n\nEscreve *menu* para ver o que posso fazer por ti.`
    );
  }
}

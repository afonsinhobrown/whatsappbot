import { askAI } from "../services/aiService.js";
import { getSession, setSession } from "../services/sessionService.js";
import { query } from "../services/dbService.js";
import { sendTextMessage } from "../services/metaApi.js";

const MAX_SDR_TURNS = 6; // Limite de trocas para não cansar o lead

/**
 * Inicia o fluxo de SDR (qualificação de lead).
 */
export async function startSDR(client, send, tenant) {
  await setSession(client.id, "sdr_qualificacao", { sdr_history: [] });
  
  const mensagemInicial = `Olá, ${client.nome || "amigo"}! 👋\n\nVejo que tens interesse nos nossos sistemas. Para te recomendar a melhor solução, posso fazer-te umas 3 perguntinhas rápidas?`;
  return send(mensagemInicial);
}

/**
 * Lida com a conversa de qualificação em modo SDR.
 */
export async function handleSDR(client, ctx, text, send, tenant) {
  let history = ctx.sdr_history || [];
  
  // Acrescentar a mensagem do cliente ao histórico
  history.push({ role: "user", content: text });
  
  // Prompt de sistema específico para o SDR
  const sdrPrompt = `És um SDR (Sales Development Representative) especialista em vendas B2B da ${tenant.nome || "TecnoIncubadora"}.
O teu objetivo é fazer perguntas para descobrir:
1. Qual é o ramo de negócio do cliente?
2. Qual é a sua maior dor ou problema atual com a gestão?
3. Quantos funcionários/utilizadores vão usar o sistema?

REGRAS CRÍTICAS:
- Faz APENAS UMA pergunta de cada vez.
- Sê muito empático e coloquial.
- Se já tiveres respostas suficientes (ramo de negócio, problema, tamanho da equipa), encerra dizendo "Excelente, já tenho o que preciso. Vou passar estes dados à nossa equipa para agendar uma demonstração contigo. Obrigado!". E USA EXACTAMENTE A PALAVRA "SDR_QUALIFICADO" algures na tua mensagem final (importante para eu saber que terminaste).
- Se o cliente for rude ou disser que não quer responder, responde pedindo desculpa e encerra dizendo "SDR_QUALIFICADO".`;

  try {
    // Pedir à IA a próxima resposta
    let aiResponse = await askAI(text, [
      { role: "system", content: sdrPrompt },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ], tenant);
    
    const isQualificado = aiResponse.includes("SDR_QUALIFICADO");
    
    // Limpar a flag secreta da resposta que o cliente vai ver
    const respostaLimpa = aiResponse.replace("SDR_QUALIFICADO", "").trim();
    
    // Gravar o progresso
    history.push({ role: "assistant", content: respostaLimpa });
    
    if (isQualificado || history.length >= MAX_SDR_TURNS * 2) {
      // O lead está qualificado ou já falámos demais
      
      // Guardar na BD
      const resumoPrompt = "Resume numa frase o ramo, dor e tamanho desta empresa com base nesta conversa: " + JSON.stringify(history);
      const necessidade = await askAI(resumoPrompt, [], tenant);
      
      try {
        await query(
          "INSERT INTO leads (cliente_id, tenant_id, necessidade) VALUES ($1, $2, $3)",
          [client.id, tenant.id, necessidade]
        );
      } catch (err) {
        console.error("[SDR] Falha ao gravar lead na BD (a tabela leads pode não existir ainda):", err.message);
      }
      
      // Avisar administrador
      await sendTextMessage(process.env.ADMIN_WHATSAPP_NUMBER || "", `🚨 *Novo Lead Qualificado!*\n\n*Cliente:* ${client.nome} (${client.whatsapp_number})\n*Resumo:* ${necessidade}\n\nUsa o comando !responder para lhe falar.`, tenant).catch(() => {});
      
      // Tirar do estado SDR
      await setSession(client.id, "menu", {});
      
      if (respostaLimpa) {
        return send(respostaLimpa);
      } else {
        return send("Pronto, a nossa equipa já foi notificada e vai contactar-te em breve para uma demonstração. Obrigado!");
      }
    }
    
    // Ainda em qualificação
    await setSession(client.id, "sdr_qualificacao", { sdr_history: history });
    return send(respostaLimpa);
    
  } catch (err) {
    console.error("[SDR] Erro:", err);
    return send("Desculpa, tive um problema técnico. Podes repetir a resposta?");
  }
}

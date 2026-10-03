import { query } from "../services/dbService.js";
import { askAI } from "../services/aiService.js";
import { adminNumbers } from "../config/env.js";

/**
 * Gera um relatório e dashboard de gestão (Vendas, Pagamentos e Leads) 
 * enviando os dados resumidos e analisados pelo Gemini.
 */
export async function sendDashboardReport(send, tenant) {
  try {
    // 1. Obter Estatísticas de Pagamentos (Total de Sucesso nos últimos 30 dias vs Pendentes)
    const pagamentosQuery = await query(`
      SELECT 
        status, 
        COUNT(*) as quantidade, 
        SUM(valor) as total, 
        moeda 
      FROM pagamentos 
      WHERE tenant_id = $1 AND created_at > now() - interval '30 days'
      GROUP BY status, moeda
    `, [tenant.id]);

    // 2. Obter Estatísticas de Leads
    const leadsQuery = await query(`
      SELECT 
        estado, 
        COUNT(*) as quantidade 
      FROM leads 
      WHERE tenant_id = $1
      GROUP BY estado
    `, [tenant.id]);

    // 3. Obter Estatísticas de Licenças (Ativas vs Expiradas)
    const licencasQuery = await query(`
      SELECT 
        status, 
        COUNT(*) as quantidade 
      FROM licencas 
      WHERE tenant_id = $1
      GROUP BY status
    `, [tenant.id]);

    // Preparar os dados puros (Raw Data)
    const dadosGerais = {
      pagamentos_ultimos_30_dias: pagamentosQuery.rows,
      leads_estado_atual: leadsQuery.rows,
      licencas_estado_atual: licencasQuery.rows
    };

    // 4. Pedir ao Gemini para formatar e analisar isto como um Consultor de Gestão
    const prompt = `
És o Consultor Financeiro e de Negócios (IA) da ${tenant.nome || "empresa"}.
O teu CEO/Administrador acabou de pedir um resumo do estado do negócio (Dashboard).

Aqui estão os dados estruturados da base de dados (em JSON):
${JSON.stringify(dadosGerais, null, 2)}

A tua Tarefa:
Escreve uma mensagem de WhatsApp muito profissional, mas fácil de ler (com emojis e negritos), resumindo estes números. 
- Faz secções para: 💰 Vendas & Pagamentos, 🎯 Leads & Oportunidades, 🔒 Licenças Ativas.
- Se não houver dados, diz simplesmente que ainda não há movimentos recentes nessa área.
- Termina com um pequeno conselho de gestão ou incentivo curto!`;

    send("A gerar o teu Dashboard... 📊 (Isto pode demorar uns segundos)");
    
    const relatorioIA = await askAI(prompt, [], tenant);
    
    return send(relatorioIA);

  } catch (err) {
    console.error("[DASHBOARD] Erro ao gerar relatorio:", err);
    return send("❌ Ocorreu um erro ao gerar o dashboard. Tenta mais tarde.");
  }
}

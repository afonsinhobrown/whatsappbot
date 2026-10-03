import { query } from "../services/dbService.js";
import { createPaySuiteCharge } from "../services/paysuiteService.js";
import { askAI } from "../services/aiService.js";
import { sendTextMessage } from "../services/metaApi.js";
import { env } from "../config/env.js";

/**
 * Procura licenças que caducam nos próximos 3 dias ou que já caducaram hoje,
 * gera um pagamento no PaySuite, usa o Gemini para criar uma mensagem de cobrança amigável
 * e envia para o WhatsApp do cliente.
 */
export async function processarCobrancasDiarias() {
  console.log("[CRON] A iniciar processamento de cobranças automáticas...");

  // Buscar licenças ativas que expiram em 3 dias ou menos, ou que já expiraram há pouco tempo
  const sql = `
    SELECT
      l.id as licenca_id, l.data_expiracao,
      c.id as cliente_id, c.whatsapp_number, c.nome as cliente_nome,
      p.nome_plano, p.preco, p.moeda,
      t.id as tenant_id, t.nome as tenant_nome
    FROM licencas l
    JOIN clientes c ON l.cliente_id = c.id
    JOIN planos p ON l.plano_id = p.id
    JOIN tenants t ON l.tenant_id = t.id
    WHERE l.status = 'ativo'
      AND l.data_expiracao IS NOT NULL
      AND l.data_expiracao BETWEEN now() - interval '1 day' AND now() + interval '3 days'
  `;

  const { rows: licencasParaCobrar } = await query(sql);

  if (licencasParaCobrar.length === 0) {
    console.log("[CRON] Não há cobranças para fazer hoje.");
    return { success: true, count: 0 };
  }

  let cobradas = 0;

  for (const licenca of licencasParaCobrar) {
    try {
      // 1. Verificar se já existe um pagamento pendente para esta licença recente
      const { rows: pagamentosPendentes } = await query(
        `SELECT id FROM pagamentos 
         WHERE referencia_id = $1 
           AND status = 'pending' 
           AND created_at > now() - interval '5 days'
         LIMIT 1`,
        [licenca.licenca_id]
      );

      if (pagamentosPendentes.length > 0) {
        console.log(`[CRON] Cliente ${licenca.cliente_nome} já tem pagamento pendente. Ignorar.`);
        continue;
      }

      // 2. Gerar link de pagamento na PaySuite
      const baseUrl = env.publicUrl || "https://tecnoincubadora-admin-bots.vercel.app";
      const payment = await createPaySuiteCharge(licenca.preco, licenca.licenca_id, {
        description: `Renovação de ${licenca.nome_plano}`,
        webhookUrl: `${baseUrl}/api/paysuite/webhook`,
      });

      // Guardar pagamento na BD
      await query(
        `INSERT INTO pagamentos (cliente_id, referencia_tipo, referencia_id, valor, moeda, status, paysuite_id, paysuite_checkout_url, tenant_id)
         VALUES ($1, 'licenca', $2, $3, $4, 'pending', $5, $6, $7)`,
        [
          licenca.cliente_id,
          licenca.licenca_id,
          licenca.preco,
          licenca.moeda || 'MZN',
          payment.id,
          payment.checkoutUrl,
          licenca.tenant_id
        ]
      );

      // 3. Formular mensagem com o Gemini
      const prompt = `
Escreve uma mensagem de WhatsApp muito simpática, curta e direta para o cliente "${licenca.cliente_nome}".
Informa-o que a sua licença do sistema "${licenca.nome_plano}" expira (ou expirou) por volta do dia ${new Date(licenca.data_expiracao).toLocaleDateString('pt-MZ')}.
O valor da renovação é ${licenca.preco} ${licenca.moeda || 'MZN'}.
Avisa que pode pagar facilmente por M-Pesa ou e-Mola clicando no link abaixo.

Regras:
- Mantém a mensagem curta (2-3 parágrafos)
- Sê empático, nada de tom de ameaça
- Usa 1 ou 2 emojis adequados
- Não inventes links, porque o sistema vai juntar o link real no fim da tua mensagem.

Termina a tua mensagem sem acrescentar o link (o sistema fará isso).`;

      const aiMessage = await askAI(prompt, [], { nome: licenca.tenant_nome });
      
      const mensagemFinal = `${aiMessage}\n\n🔗 *Link para pagar por M-Pesa/e-Mola:*\n${payment.checkoutUrl}`;

      // 4. Enviar mensagem
      await sendTextMessage(licenca.whatsapp_number, mensagemFinal, { id: licenca.tenant_id });
      
      cobradas++;
      console.log(`[CRON] Cobrança enviada com sucesso para ${licenca.cliente_nome} (${licenca.whatsapp_number})`);
      
    } catch (err) {
      console.error(`[CRON] Erro ao processar cobrança da licença ${licenca.licenca_id}:`, err.message);
    }
  }

  return { success: true, count: cobradas };
}

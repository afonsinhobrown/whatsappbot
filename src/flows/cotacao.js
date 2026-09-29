import { query } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";
import { buildCatalog, productPlansMessage } from "./planos.js";

const TIPOS = {
  1: "produto_existente",
  2: "sistema_custom",
  3: "servico",
};

/** Opção 1 do menu — começa por perguntar o tipo de cotação. */
export async function startCotacao(client, send) {
  await setSession(client.id, "cotacao_tipo", {});
  return send(
    "Que tipo de cotação precisa?\n\n" +
      "1 - Produto existente (SaaS/bot/plugin)\n" +
      "2 - Sistema/serviço à medida\n" +
      "3 - Serviço\n\n" +
      'Responda 1, 2, 3 ou "0" para cancelar.'
  );
}

/** Opção 4 do menu — encomenda de sistema/serviço novo. */
export async function startEncomenda(client, send) {
  await setSession(client.id, "cotacao_descricao", { tipoPedido: "sistema_custom" });
  return send(
    "Descreva o sistema ou serviço novo que quer encomendar.\n" +
      "Inclua funcionalidades, prazo desejado e, se tiver, o orçamento disponível.\n\n" +
      '("0" para cancelar)'
  );
}

export async function handleCotacaoTipo(client, _ctx, text, send) {
  const tipo = TIPOS[text.trim()];
  if (!tipo) {
    return send('Escolha 1, 2 ou 3 (ou "0" para cancelar).');
  }

  // Produto existente → mostrar o catálogo para o cliente escolher
  if (tipo === "produto_existente") {
    const { produtoIds, msg } = await buildCatalog(client.tenant_id);
    await setSession(client.id, "cotacao_produto_lista", { produtoIds });
    return send(msg);
  }

  await setSession(client.id, "cotacao_descricao", { tipoPedido: tipo });
  return send("Descreva, por favor, o que precisa (produto, detalhes, quantidades, prazo).");
}

/** Cliente escolheu um produto existente por número. */
export async function handleCotacaoProdutoLista(client, ctx, text, send) {
  const ids = ctx.produtoIds || [];
  const n = parseInt(text.trim(), 10);
  if (!n || n < 1 || n > ids.length) {
    return send('Escolha um número válido da lista, ou "0" para voltar.');
  }

  const { nome, msg } = await productPlansMessage(client, ids[n - 1]);
  await setSession(client.id, "cotacao_descricao", {
    tipoPedido: "produto_existente",
    produto: nome,
  });
  return send(msg + `\n\nDescreva, por favor, o que precisa para *${nome}* (quantidade, prazo, etc.).`);
}

export async function handleCotacaoDescricao(client, ctx, text, send) {
  const descricao = text.trim();
  if (descricao.length < 5) {
    return send("Descreva um pouco mais, por favor.");
  }
  const tipoPedido = ctx.tipoPedido || "servico";
  const prefixo = ctx.produto ? `[Produto: ${ctx.produto}] ` : "";

  await query(
    `INSERT INTO cotacoes (tenant_id, cliente_id, tipo_pedido, descricao, status)
     VALUES ($1, $2, $3, $4, 'aberta')`,
    [client.tenant_id, client.id, tipoPedido, prefixo + descricao]
  );

  await setSession(client.id, "menu", {});
  console.log(`[ADMIN] Nova cotação de ${client.whatsapp_number} (${tipoPedido}): ${prefixo}${descricao}`);

  return send(
    "✅ Cotação recebida!\n" +
      "A nossa equipa vai analisar e enviar-lhe o orçamento em breve.\n\n" +
      'Escreva "menu" para voltar às opções.'
  );
}

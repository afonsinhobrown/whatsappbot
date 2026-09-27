import { query } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";

const TIPO_ORDER = ["saas", "bot", "plugin", "servico_custom"];
const TIPO_LABEL = {
  saas: "SaaS",
  bot: "Bots",
  plugin: "Plugins",
  servico_custom: "Produtos e Serviços",
};

function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MZN";
}

/**
 * Constrói o catálogo organizado por tipo, com preços.
 * Devolve { produtoIds, msg } — produtoIds permite mapear o número escolhido.
 */
export async function buildCatalog(tenantId) {
  const { rows: produtos } = await query(
    "SELECT id, tipo, nome FROM produtos WHERE tenant_id = $1 AND ativo = true ORDER BY nome",
    [tenantId]
  );
  const { rows: planos } = await query(
    "SELECT produto_id, min(preco) AS min_preco, count(*)::int AS n FROM planos WHERE tenant_id = $1 AND ativo = true GROUP BY produto_id",
    [tenantId]
  );

  const porProduto = {};
  for (const p of planos) porProduto[p.produto_id] = p;

  const porTipo = {};
  for (const p of produtos) {
    (porTipo[p.tipo] = porTipo[p.tipo] || []).push(p);
  }

  const produtoIds = [];
  let msg = "📦 Produtos e serviços:\n";

  for (const tipo of TIPO_ORDER) {
    const lista = porTipo[tipo] || [];
    if (tipo === "plugin" && lista.length === 0) {
      msg += `\n*${TIPO_LABEL[tipo]}*\n(disponível em breve)\n`;
      continue;
    }
    if (lista.length === 0) continue;

    msg += `\n*${TIPO_LABEL[tipo]}*\n`;
    for (const p of lista) {
      produtoIds.push(p.id);
      const info = porProduto[p.id];
      let preco = "";
      if (info && info.n > 0 && Number(info.min_preco) > 0) {
        preco = ` — desde ${formatMoney(info.min_preco)}`;
      } else if (info && info.n > 0) {
        preco = " — sob consulta";
      }
      msg += `${produtoIds.length}. ${p.nome}${preco}\n`;
    }
  }

  msg += "\nResponda com o número para ver os planos/preços, ou \"0\" para voltar.";
  return { produtoIds, msg };
}

/**
 * Devolve a mensagem com os planos/licenças de um produto (sem prompt final).
 */
export async function productPlansMessage(tenantId, produtoId) {
  const { rows: prod } = await query(
    "SELECT id, tipo, nome FROM produtos WHERE id = $1 AND tenant_id = $2",
    [produtoId, tenantId]
  );
  const produto = prod[0];
  if (!produto) return { nome: null, msg: "Produto não encontrado.", planos: [] };

  const { rows: planos } = await query(
    `SELECT id, nome_plano, preco, periodo
       FROM planos
      WHERE produto_id = $1 AND tenant_id = $2 AND ativo = true
      ORDER BY preco`,
    [produtoId, tenantId]
  );

  let msg = `📦 *${produto.nome}* (${TIPO_LABEL[produto.tipo] || produto.tipo})\n\n`;
  if (planos.length) {
    msg += "Planos / licenças:\n";
    planos.forEach((pl, i) => {
      const valor = Number(pl.preco) > 0 ? formatMoney(pl.preco) : "sob consulta";
      msg += `${i + 1}. ${pl.nome_plano} — ${valor}${pl.periodo ? " / " + pl.periodo : ""}\n`;
    });
  } else {
    msg += "Este serviço é orçamentado à medida.\n";
  }
  return { nome: produto.nome, msg: msg.trimEnd(), planos };
}

/** Opção 2 do menu — catálogo. */
export async function showProdutos(client, send) {
  const { produtoIds, msg } = await buildCatalog(client.tenant_id);
  await setSession(client.id, "planos_lista", { produtoIds });
  return send(msg);
}

/** Escolha de produto na opção 2 — mostra os planos e pede para escolher. */
export async function handlePlanoEscolha(client, ctx, text, send) {
  const ids = ctx.produtoIds || [];
  const n = parseInt(text.trim(), 10);
  if (!n || n < 1 || n > ids.length) {
    return send('Escolha um número válido da lista, ou "0" para voltar.');
  }
  const { nome, msg, planos } = await productPlansMessage(client.tenant_id, ids[n - 1]);

  if (!planos.length) {
    await setSession(client.id, "menu", {});
    return send(
      msg +
        '\n\nEste serviço é orçamentado à medida. Responda "1" para pedir cotação ou "0" para voltar.'
    );
  }

  await setSession(client.id, "planos_plano", {
    produtoId: ids[n - 1],
    produto: nome,
    planos: planos.map((p) => p.id),
  });
  return send(msg + '\n\nEscolha o plano pelo número para contratar, ou "0" para voltar.');
}


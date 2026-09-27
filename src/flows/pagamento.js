import { query } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";

const METODOS = { 1: "emola", 2: "mpesa", 3: "visa" };
const METODO_LABEL = { emola: "e-Mola", mpesa: "M-Pesa", visa: "Visa" };

function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MZN";
}

function metodosTexto(descricao, valor) {
  return (
    `Escolha o método de pagamento para ${descricao} (${formatMoney(valor)}):\n\n` +
    "1 - e-Mola\n2 - M-Pesa\n3 - Visa\n\n" +
    '("0" para cancelar)'
  );
}

/**
 * Escolha do plano (opção 2): cria licença pendente + pagamento pendente
 * e pede o método de pagamento.
 */
export async function handlePlanoContratar(client, ctx, text, send) {
  const planos = ctx.planos || [];
  const n = parseInt(text.trim(), 10);
  if (!n || n < 1 || n > planos.length) {
    return send('Escolha um número válido do plano, ou "0" para voltar.');
  }
  const planoId = planos[n - 1];

  const { rows } = await query(
    `SELECT pl.id, pl.nome_plano, pl.preco, pr.nome AS produto
       FROM planos pl JOIN produtos pr ON pr.id = pl.produto_id
      WHERE pl.id = $1 AND pl.tenant_id = $2`,
    [planoId, client.tenant_id]
  );
  const plano = rows[0];
  if (!plano) {
    await setSession(client.id, "menu", {});
    return send('Plano não encontrado. Escreva "menu" para voltar.');
  }

  const lic = await query(
    `INSERT INTO licencas (tenant_id, cliente_id, plano_id, status)
     VALUES ($1, $2, $3, 'pendente') RETURNING id`,
    [client.tenant_id, client.id, planoId]
  );
  const licencaId = lic.rows[0].id;

  const pag = await query(
    `INSERT INTO pagamentos (tenant_id, cliente_id, referencia_tipo, referencia_id, valor, moeda, status)
     VALUES ($1, $2, 'licenca', $3, $4, 'MZN', 'pendente') RETURNING id`,
    [client.tenant_id, client.id, licencaId, plano.preco]
  );
  const pagamentoId = pag.rows[0].id;

  const descricao = `*${plano.produto} — ${plano.nome_plano}*`;
  await setSession(client.id, "pagamento_metodo", {
    licencaId,
    pagamentoId,
    valor: plano.preco,
    descricao,
  });
  console.log(`[ADMIN] Licença #${licencaId} pendente (cliente ${client.whatsapp_number}), pagamento #${pagamentoId}`);
  return send(metodosTexto(descricao, plano.preco));
}

/** Escolha do método de pagamento. */
export async function handlePagamentoMetodo(client, ctx, text, send) {
  const metodo = METODOS[text.trim()];
  if (!metodo) {
    return send("Escolha 1 (e-Mola), 2 (M-Pesa) ou 3 (Visa), ou \"0\" para cancelar.");
  }

  await query("UPDATE pagamentos SET metodo = $2 WHERE id = $1", [ctx.pagamentoId, metodo]);
  await setSession(client.id, "menu", {});

  const descricao = ctx.descricao || "a sua licença";
  console.log(
    `[ADMIN] Pagamento #${ctx.pagamentoId} (${METODO_LABEL[metodo]}) para ${descricao} — aguarda confirmação`
  );

  return send(
    `Método registado: *${METODO_LABEL[metodo]}*\n` +
      `Referência: pagamento *${ctx.pagamentoId}*\n` +
      `Valor: ${formatMoney(ctx.valor)}\n\n` +
      "📲 A integração de pagamento automático (PaySuite/Netshop) está a ser concluída.\n" +
      'Entretanto, pode enviar o comprovativo aqui ou escrever "5" para falar com um humano.\n\n' +
      'Escreva "menu" para voltar.'
  );
}

/** Opção 3 do menu — as licenças/pagamentos do cliente. */
export async function showPagamento(client, send) {
  const { rows } = await query(
    `SELECT l.id, l.status,
            pl.nome_plano, pl.preco, pr.nome AS produto,
            pg.id AS pagamento_id, pg.metodo, pg.status AS pagamento_status
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
       LEFT JOIN pagamentos pg ON pg.referencia_tipo = 'licenca' AND pg.referencia_id = l.id
      WHERE l.cliente_id = $1
      ORDER BY l.id DESC`,
    [client.id]
  );

  if (!rows.length) {
    return send(
      "Não encontrei licenças associadas a este número. 🔎\n\n" +
        "Se quer contratar, use a opção 2 (ver planos/preços).\n" +
        'Escreva "menu" para voltar.'
    );
  }

  let msg = "💳 As suas licenças:\n\n";
  let pendente = null;
  for (const l of rows) {
    msg += `#${l.id} — ${l.produto || "?"} (${l.nome_plano || "?"}) · ${l.status}\n`;
    if (l.pagamento_id) {
      msg += `   Pagamento #${l.pagamento_id}: ${l.pagamento_status}${
        l.metodo ? " (" + (METODO_LABEL[l.metodo] || l.metodo) + ")" : ""
      }\n`;
      if (l.pagamento_status === "pendente" && !pendente) {
        pendente = { pagamentoId: l.pagamento_id, valor: l.preco, descricao: `${l.produto} — ${l.nome_plano}` };
      }
    }
    msg += "\n";
  }

  if (pendente) {
    await setSession(client.id, "pagamento_metodo", pendente);
    msg += metodosTexto(`*${pendente.descricao}*`, pendente.valor);
    return send(msg);
  }

  msg += 'Escreva "menu" para voltar.';
  return send(msg);
}

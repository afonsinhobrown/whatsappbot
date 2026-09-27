import { query } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";
import { validarXonguile } from "../services/saasService.js";
import { createPaySuiteCharge } from "../services/paysuiteService.js";

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
 * Escolha do plano (opção 2): em vez de criar logo o pagamento, 
 * pergunta pelas credenciais do sistema ou ID do ginásio.
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

  // Prepara o contexto
  const newCtx = { planoId, preco: plano.preco, produto: plano.produto, nome_plano: plano.nome_plano };

  const produtoNomeLower = plano.produto.toLowerCase();
  
  // Se for o sistema do ginásio (hefelgym / gymar)
  if (produtoNomeLower.includes("hefelgym") || produtoNomeLower.includes("gym")) {
    await setSession(client.id, "pagamento_hefelgym_id", newCtx);
    return send(`Para pagar a mensalidade do *${plano.produto}*:\n\nPor favor, digite o seu *Nome completo* ou o seu *ID de cliente* do ginásio:`);
  } else {
    // SaaS normal: pedir utilizador
    await setSession(client.id, "pagamento_saas_user", newCtx);
    return send(`Para processar a licença do sistema *${plano.produto}*:\n\nPor favor, digite o *Usuário (username)* que usa para aceder à sua conta no sistema:`);
  }
}

export async function handlePagamentoSaasUser(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.saasUser = text.trim();
  await setSession(client.id, "pagamento_saas_senha", ctx);
  return send(`Excelente. Agora, por favor, digite a sua *Senha* para validar a conta do sistema *${ctx.produto}*:`);
}

export async function handlePagamentoSaasSenha(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.saasSenha = text.trim();

  // Validar automaticamente se for o Xonguile
  if (ctx.produto && ctx.produto.toLowerCase().includes("xonguile")) {
    await send("⏳ A validar a sua conta no Xonguile...");
    const check = await validarXonguile(ctx.saasUser, ctx.saasSenha);
    if (!check.valid) {
      await setSession(client.id, "pagamento_saas_user", ctx);
      return send("❌ *Credenciais inválidas!* O Utilizador ou a Senha não estão corretos.\n\nPor favor, digite novamente o seu *Usuário (username)* (ou \"0\" para cancelar):");
    }
    // Se for válido, anexamos o nome verdadeiro da conta ao contexto
    ctx.contaNome = check.user.name;
    await send(`✅ *Conta confirmada:* Olá, ${check.user.name}!`);
  }

  return createLicencaAndAskMetodo(client, ctx, send);
}

export async function handlePagamentoHefelgymId(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.hefelgymId = text.trim();
  return createLicencaAndAskMetodo(client, ctx, send);
}

/** 
 * Cria as entradas na BD (licenca e pagamento pendentes)
 * e pede o método de pagamento (e-Mola, M-Pesa, Visa).
 */
async function createLicencaAndAskMetodo(client, ctx, send) {
  const { planoId, preco, produto, nome_plano, saasUser, saasSenha, hefelgymId } = ctx;
  
  // Os dados extra (user/senha/id) podem ser guardados nas observações da licença ou num campo JSON.
  // Como não há schema visível para isso na instrução, registamos no console e associamos o pagamento
  const dadosConta = hefelgymId ? `[Gym ID: ${hefelgymId}]` : `[SaaS User: ${saasUser} | Senha: ${saasSenha}]`;
  
  const lic = await query(
    `INSERT INTO licencas (tenant_id, cliente_id, plano_id, status)
     VALUES ($1, $2, $3, 'pendente') RETURNING id`,
    [client.tenant_id, client.id, planoId]
  );
  const licencaId = lic.rows[0].id;

  const pag = await query(
    `INSERT INTO pagamentos (tenant_id, cliente_id, referencia_tipo, referencia_id, valor, moeda, status)
     VALUES ($1, $2, 'licenca', $3, $4, 'MZN', 'pendente') RETURNING id`,
    [client.tenant_id, client.id, licencaId, preco]
  );
  const pagamentoId = pag.rows[0].id;

  const descricao = `*${produto} — ${nome_plano}*`;
  
  await setSession(client.id, "pagamento_metodo", {
    licencaId,
    pagamentoId,
    valor: preco,
    descricao,
  });
  
  console.log(`[ADMIN] Licença #${licencaId} pendente (cliente ${client.whatsapp_number}), pagamento #${pagamentoId}. Conta do cliente: ${dadosConta}`);
  return send(metodosTexto(descricao, preco));
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

  let extraMessage = "📲 A integração de pagamento automático (PaySuite/Netshop) está a ser concluída.\nEntretanto, pode enviar o comprovativo aqui.";

  // Se o método for e-Mola, gerar link da PaySuite automaticamente
  if (metodo === "emola") {
    try {
      await send("⏳ A gerar link de pagamento na PaySuite para o e-Mola...");
      const charge = await createPaySuiteCharge(ctx.valor, ctx.pagamentoId);
      
      if (charge.checkoutUrl) {
        extraMessage = `✅ *Link de Pagamento e-Mola gerado com sucesso!*\n\nPor favor, clique no link abaixo para inserir o seu número e confirmar o pagamento:\n🔗 ${charge.checkoutUrl}\n\nApós o pagamento, a sua licença será ativada!`;
      }
    } catch (err) {
      console.error("Erro na PaySuite:", err);
      extraMessage = "⚠️ Ocorreu um erro ao gerar o link automático da PaySuite.\nPor favor, efetue o pagamento manualmente e envie o comprovativo aqui.";
    }
  }

  return send(
    `Método registado: *${METODO_LABEL[metodo]}*\n` +
      `Referência: pagamento *${ctx.pagamentoId}*\n` +
      `Valor: ${formatMoney(ctx.valor)}\n\n` +
      `${extraMessage}\n\n` +
      'Escreva "5" para falar com um humano, ou "menu" para voltar.'
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

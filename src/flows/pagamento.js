import { query } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";
import { validarContaSaaS, ativarLicenca } from "../services/saasService.js";
import { createPaySuiteCharge, getPaySuiteCharge } from "../services/paysuiteService.js";
import { sendTextMessage } from "../services/metaApi.js";
import { env } from "../config/env.js";

const METODO_LABEL = { emola: "e-Mola", mpesa: "M-Pesa", visa: "Visa", cartao: "Cartão" };

// Estados que a PaySuite usa para dizer "o dinheiro entrou".
const ESTADOS_PAGOS = new Set(["paid", "completed", "confirmed", "succeeded"]);

// Comandos que o messageHandler trata globalmente (menu, cancelar, voltar...).
// Repetidos aqui para que o cliente nunca fique preso neste estado.
const COMANDOS_MENU = ["menu", "inicio", "voltar", "cancelar", "0", "sair"];

function formatMoney(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MZN";
}

function baseUrl() {
  return env.publicUrl || "";
}

/**
 * Cria a licença + pagamento em estado pendente e ABRE a página de pagamento.
 * O cliente escolhe na própria página se paga por e-Mola, M-Pesa ou cartão —
 * o bot não pergunta o método.
 */
async function criarLicencaEAbrirPagina(client, ctx, send) {
  const { planoId, preco, produto, nome_plano, saasUser, hefelgymId } = ctx;
  const valor = Number(ctx.valor ?? preco);

  const conta = hefelgymId
    ? { tipo: "id_ginasio", valor: hefelgymId }
    : { tipo: "email", valor: saasUser };

  const lic = await query(
    `INSERT INTO licencas (tenant_id, cliente_id, plano_id, status, dados_conta)
     VALUES ($1, $2, $3, 'pendente', $4::jsonb) RETURNING id`,
    [client.tenant_id, client.id, planoId, JSON.stringify(conta)]
  );
  const licencaId = lic.rows[0].id;

  const pag = await query(
    `INSERT INTO pagamentos (tenant_id, cliente_id, referencia_tipo, referencia_id, valor, moeda, status)
     VALUES ($1, $2, 'licenca', $3, $4, 'MZN', 'pendente') RETURNING id`,
    [client.tenant_id, client.id, licencaId, valor]
  );
  const pagamentoId = pag.rows[0].id;

  const descricao = `${produto} — ${nome_plano}`;

  await setSession(client.id, "pagamento_metodo", {
    licencaId,
    pagamentoId,
    valor,
    descricao,
  });

  console.log(
    `[ADMIN] Licença #${licencaId} pendente (cliente ${client.whatsapp_number}), ` +
      `pagamento #${pagamentoId} — ${descricao} — ${formatMoney(valor)}`
  );

  return abrirPaginaPagamento(client, pagamentoId, valor, descricao, send);
}

/** Cria o pedido na PaySuite, guarda o link e envia-o ao cliente. */
export async function abrirPaginaPagamento(client, pagamentoId, valor, descricao, send) {
  // A PaySuite recusa referências repetidas, por isso um pedido só é criado
  // uma vez. Se já existe link, limitamo-nos a reenviá-lo.
  const jaCriado = await query(
    "SELECT paysuite_id, paysuite_checkout_url FROM pagamentos WHERE id = $1",
    [pagamentoId]
  );
  const existente = jaCriado.rows[0];
  if (existente && existente.paysuite_checkout_url) {
    return send(textoLinkPagamento(existente.paysuite_checkout_url, descricao, valor, false));
  }

  const base = baseUrl();
  try {
    const charge = await createPaySuiteCharge(valor, pagamentoId, {
      description: `Licenca ${descricao}`,
      webhookUrl: `${base}/admin/api/paysuite-webhook`,
      returnUrl: `${base}/admin`,
    });

    await query(
      "UPDATE pagamentos SET paysuite_id = $2, paysuite_checkout_url = $3 WHERE id = $1",
      [pagamentoId, charge.id || null, charge.checkoutUrl || null]
    );

    if (!charge.checkoutUrl) {
      return send(
        `🧾 *${descricao}* — ${formatMoney(valor)}\n\n` +
          "Não foi possível gerar a página de pagamento. Fale com um atendente:\n" +
          'Escreva "5" e resolvemos já.'
      );
    }

    return send(textoLinkPagamento(charge.checkoutUrl, descricao, valor, true));
  } catch (err) {
    console.error("[PAYSUITE] erro ao criar o pedido de pagamento:", err.message);
    return send(
      `⚠️ Não consegui abrir a página de pagamento: ${err.message}\n\n` +
        "Fale com um atendente para resolver:\n" +
        'Escreva "5".'
    );
  }
}

function textoLinkPagamento(url, descricao, valor, novo) {
  return (
    `🧾 *Pagamento — ${descricao}*\n` +
    `Valor: ${formatMoney(valor)}\n\n` +
    (novo ? "Abra esta página para pagar (e-Mola, M-Pesa ou cartão):\n" : "O seu pagamento continua pendente. Página de pagamento:\n") +
    `🔗 ${url}\n\n` +
    "A sua licença é activada automaticamente assim que o pagamento for confirmado.\n" +
    'Escreva "menu" se tiver mudado de ideias.'
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

  const newCtx = {
    planoId,
    preco: plano.preco,
    produto: plano.produto,
    nome_plano: plano.nome_plano,
  };

  const produtoNomeLower = plano.produto.toLowerCase();

  if (produtoNomeLower.includes("hefelgym") || produtoNomeLower.includes("gym")) {
    await setSession(client.id, "pagamento_hefelgym_id", newCtx);
    return send(
      `Para pagar a mensalidade do *${plano.produto}*:\n\n` +
        "Por favor, digite o seu *Nome completo* ou o seu *ID de cliente* do ginásio:"
    );
  }

  await setSession(client.id, "pagamento_saas_user", newCtx);
  return send(
    `Para processar a licença do sistema *${plano.produto}*:\n\n` +
      "Por favor, digite o *email* com que a sua conta está registada no sistema " +
      "(é por ele que validamos a conta):"
  );
}

export async function handlePagamentoSaasUser(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.saasUser = text.trim();
  await setSession(client.id, "pagamento_saas_senha", ctx);
  return send("Agora, por favor, diga a sua senha (só para confirmarmos que é você).");
}

export async function handlePagamentoSaasSenha(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.saasSenha = text.trim();

  if (ctx.produto) {
    await send(`⏳ A validar a sua conta no sistema ${ctx.produto}...`);
    const check = await validarContaSaaS(ctx.produto, ctx.saasUser, ctx.saasSenha);
    if (!check.valid) {
      if (check.error) {
        console.error(`[SAAS] validação de ${ctx.produto} falhou:`, check.error);
      }
      await setSession(client.id, "pagamento_saas_user", ctx);
      return send(
        "❌ *Não encontrámos essa conta.* Verifique o email e tente de novo.\n\n" +
          'Escreva o email, ou "0" para cancelar.'
      );
    }
    if (check.user && check.user.name) {
      ctx.contaNome = check.user.name;
      if (check.user.plan === "moz teles") {
        ctx.preco = 3000;
        ctx.valor = 3000;
        ctx.nome_plano = "moz teles (Pacote Especial)";
        await send(`✅ Conta confirmada: Olá, ${check.user.name}!\n\nValor ajustado para ${formatMoney(3000)}.`);
      } else {
        await send(`✅ Conta confirmada: Olá, ${check.user.name}!`);
      }
    } else {
      await send("✅ Conta registada para licenciamento.");
    }
  }

  return criarLicencaEAbrirPagina(client, ctx, send);
}

export async function handlePagamentoHefelgymId(client, ctx, text, send) {
  if (text.trim() === "0") {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  ctx.hefelgymId = text.trim();

  if (ctx.produto) {
    await send(`⏳ A procurar o atleta no sistema ${ctx.produto}...`);
    const check = await validarContaSaaS(ctx.produto, ctx.hefelgymId, "");
    if (!check.valid) {
      await setSession(client.id, "pagamento_hefelgym_id", ctx);
      return send(
        `❌ *Atleta não encontrado* para "${ctx.hefelgymId}".\n\n` +
          'Digite novamente o nome ou ID, ou "0" para cancelar.'
      );
    }
    if (check.user && check.user.name) {
      ctx.contaNome = check.user.name;
      if (check.user.fee) ctx.valor = Number(check.user.fee);
      await send(
        `✅ Atleta confirmado: Olá, ${check.user.name}!\n` +
          `Mensalidade: ${formatMoney(ctx.valor)}.`
      );
    }
  }

  return criarLicencaEAbrirPagina(client, ctx, send);
}

/**
 * Estado "a aguardar pagamento": qualquer mensagem reenvia a página de
 * pagamento em vez de voltar a perguntar o método.
 */
export async function handlePagamentoMetodo(client, ctx, text, send) {
  const texto = text.trim().toLowerCase();

  if (texto === "0" || texto === "menu" || COMANDOS_MENU.includes(texto)) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  if (!ctx.pagamentoId) {
    await setSession(client.id, "menu", {});
    return send('Não encontrei um pagamento pendente. Escreva "menu" para voltar.');
  }

  // O pagamento pode ter sido apagado ou já estar confirmado. Sem esta
  // verificação o cliente ficava preso neste estado para sempre.
  const atual = await query("SELECT status FROM pagamentos WHERE id = $1", [ctx.pagamentoId]);
  if (!atual.rows[0] || atual.rows[0].status === "confirmado") {
    await setSession(client.id, "menu", {});
    return send(
      "O pagamento anterior já não está pendente. 🔄\n\n" +
        'Escreva "2" para ver os planos ou "menu" para o menu principal.'
    );
  }

  return abrirPaginaPagamento(
    client,
    ctx.pagamentoId,
    Number(ctx.valor),
    ctx.descricao || "a sua licença",
    send
  );
}

/**
 * Confirma um pagamento recebido na PaySuite: marca o pagamento como
 * confirmado e activa a licença associated (1 mês a partir de agora, ou
 * acrescentando a partir da data de expiração se ainda estiver activa).
 */
/**
 * Confirma um pagamento na PaySuite e activa a licença associada
 * (1 mês a partir de agora, ou acrescentando à data de expiração se a
 * licença ainda estiver activa).
 *
 * REGRA DE OURO: nunca activamos nada sem antes perguntar à PaySuite se o
 * dinheiro entrou. Quem chama esta função só decide *quando* confirmar —
 * a verdade vem sempre da PaySuite, nunca do pedido do cliente.
 */
export async function confirmarPagamento(paysuiteId, opcoes = {}) {
  const pag = await query(
    `SELECT p.id, p.cliente_id, p.referencia_id, p.valor, p.status,
            l.plano_id, l.status AS licenca_status, l.data_expiracao,
            pl.nome_plano, pr.nome AS produto
       FROM pagamentos p
       JOIN licencas l ON l.id = p.referencia_id AND p.referencia_tipo = 'licenca'
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
      WHERE p.paysuite_id = $1
      LIMIT 1`,
    [String(paysuiteId)]
  );
  const pagamento = pag.rows[0];
  if (!pagamento) return { ok: false, motivo: "pagamento não encontrado" };
  if (pagamento.status === "confirmado") return { ok: true, jaConfirmado: true };

  // 1) A PaySuite é a fonte da verdade. Sem isto, qualquer bug daria uma
  //    licença de graça e activaria contas reais de clientes.
  //    O endpoint GET só devolve `status` quando o pagamento está pago, e
  //    traz o objecto `transaction` nesse caso.
  const situacao = await getPaySuiteCharge(String(paysuiteId));
  const estadoPaySuite = String(situacao.status || (situacao.transaction && situacao.transaction.status) || "").toLowerCase();
  const pago = ESTADOS_PAGOS.has(estadoPaySuite);
  console.log(
    `[PAGAMENTO] #${pagamento.id} PaySuite diz "${estadoPaySuite || "sem estado"}" ` +
      `(pretendido ${formatMoney(pagamento.valor)})`
  );

  if (!pago) {
    return {
      ok: false,
      motivo: "pagamento ainda não confirmado",
      paysuite_status: estadoPaySuite || "pendente",
    };
  }

  // 2) A PaySuite não diz qual a licença; conferimos que o valor pedido
  //    é o valor pago, para que ninguém pague 100 e active 3.900.
  const valorPago = Number(situacao.amount ?? pagamento.valor);
  if (valorPago + 0.01 < Number(pagamento.valor)) {
    console.error(
      `[PAGAMENTO] #${pagamento.id} valor insuficiente: pago ${valorPago}, exigido ${pagamento.valor}`
    );
    return { ok: false, motivo: `valor insuficiente (pago ${valorPago}, exigido ${pagamento.valor})` };
  }

  const dataInicio = new Date();
  // Cópia explícita: sem isto, dataExpiracao e dataInicio seriam o mesmo
  // objecto e o setMonth mexeria nos dois (data_inicio também saltava 1 mês).
  const dataExpiracao =
    pagamento.data_expiracao && new Date(pagamento.data_expiracao) > dataInicio
      ? new Date(pagamento.data_expiracao)
      : new Date(dataInicio);
  dataExpiracao.setMonth(dataExpiracao.getMonth() + 1);

  await query("UPDATE pagamentos SET status = 'confirmado' WHERE id = $1", [pagamento.id]);
  await query(
    `UPDATE licencas SET status = 'ativa', data_inicio = $2, data_expiracao = $3
      WHERE id = $1`,
    [pagamento.referencia_id, dataInicio.toISOString(), dataExpiracao.toISOString()]
  );

  // 3) Activar/renovar no sistema SaaS do cliente, se houver conector.
  //    Só com pagamento verificado acima.
  let noSaas = null;
  try {
    const conta = await query("SELECT dados_conta FROM licencas WHERE id = $1", [pagamento.referencia_id]);
    const dados = conta.rows[0] && conta.rows[0].dados_conta;
    if (dados && dados.valor && pagamento.produto) {
      noSaas = await ativarLicenca(pagamento.produto, dados.valor, 1);
    }
  } catch (err) {
    console.error("[SAAS] erro ao activar a licença:", err.message);
  }

  console.log(
    `[PAGAMENTO] #${pagamento.id} confirmado — licença #${pagamento.referencia_id} activada ` +
      `até ${dataExpiracao.toISOString().slice(0, 10)} (SaaS: ${noSaas === null ? "n/d" : noSaas ? "ok" : "falhou"})`
  );

  const resumo = {
    ok: true,
    cliente_id: pagamento.cliente_id,
    whatsapp: await clienteWhatsapp(pagamento.cliente_id),
    produto: pagamento.produto,
    plano: pagamento.nome_plano,
    valor: pagamento.valor,
    data_expiracao: dataExpiracao.toISOString(),
    sausActivado: noSaas,
  };

  await notificarDono(resumo, pagamento, paysuiteId, noSaas);

  return resumo;
}

/**
 * Aviso de venda para o dono da loja. Falha aqui nunca pode impedir a
 * licença de ficar activa, por isso o erro é só registado.
 */
async function notificarDono(resumo, pagamento, paysuiteId, noSaas) {
  const numeros = env.adminNumbers.filter((n) => n !== resumo.whatsapp);
  if (!numeros.length) return;

  const texto =
    `💰 *Venda confirmada*\n\n` +
    `Cliente: ${resumo.whatsapp || "desconhecido"}\n` +
    `Produto: ${resumo.produto || "—"} — ${resumo.plano || "—"}\n` +
    `Valor: ${formatMoney(resumo.valor)}\n` +
    `Licença: #${pagamento.referencia_id} até ${resumo.data_expiracao.slice(0, 10)}\n` +
    `Pagamento PaySuite: ${paysuiteId}\n` +
    (noSaas === true
      ? "✅ Conta activada no sistema do cliente"
      : noSaas === false
        ? "⚠️ Pagamento ok, mas a conta no sistema do cliente NÃO foi activada"
        : "");

  for (const numero of numeros) {
    try {
      await sendTextMessage(numero, texto);
    } catch (err) {
      console.error(`[PAGAMENTO] não consegui avisar o dono (${numero}):`, err.message);
    }
  }
}

async function clienteWhatsapp(clienteId) {
  const r = await query("SELECT whatsapp_number FROM clientes WHERE id = $1", [clienteId]);
  return r.rows[0] ? r.rows[0].whatsapp_number : null;
}

/** Opção 3 do menu — as licenças/pagamentos do cliente. */
export async function showPagamento(client, send) {
  await setSession(client.id, "pagamento_buscar_conta", {});
  return send(
    "Para qual conta deseja pagar a licença?\n\n" +
    "Por favor, digite o *email* ou o *ID de cliente* associado à licença:\n\n" +
    '(escreva "0" para voltar)'
  );
}

export async function handlePagamentoBuscarConta(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const { rows } = await query(
    `SELECT l.id, l.status,
            pl.nome_plano, pl.preco, pr.nome AS produto,
            pg.id AS pagamento_id, pg.metodo, pg.status AS pagamento_status,
            pg.valor, pg.paysuite_checkout_url
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
       LEFT JOIN pagamentos pg ON pg.referencia_tipo = 'licenca' AND pg.referencia_id = l.id
      WHERE l.tenant_id = $1 AND LOWER(l.dados_conta->>'valor') = LOWER($2)
      ORDER BY l.id DESC`,
    [client.tenant_id, texto]
  );

  if (!rows.length) {
    return send(
      `Não encontrei nenhuma licença associada à conta "${texto}". 🔎\n\n` +
      'Tente novamente com outro email/ID ou escreva "0" para cancelar.'
    );
  }

  let msg = `💳 Licenças para a conta *${texto}*:\n\n`;
  const licencasIds = [];

  for (const l of rows) {
    msg += `#${l.id} — ${l.produto || "?"} (${l.nome_plano || "?"}) · ${l.status}\n`;
    if (l.pagamento_id) {
      msg += `   Pagamento #${l.pagamento_id}: ${l.pagamento_status}\n`;
    }
    msg += "\n";
    if (!licencasIds.includes(l.id)) licencasIds.push(l.id);
  }

  msg += 'Qual licença deseja pagar ou renovar? Digite apenas o número (ex: ' + licencasIds[0] + ').\n\n' +
         '(escreva "0" para voltar)';

  await setSession(client.id, "pagamento_escolher_licenca", { emailOuId: texto });
  return send(msg);
}

export async function handlePagamentoEscolherLicenca(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const licencaId = parseInt(texto, 10);
  if (isNaN(licencaId)) {
    return send('Por favor, digite um número de licença válido ou "0" para cancelar.');
  }

  // Verificar se a licença pertence à conta inserida
  const { rows } = await query(
    `SELECT l.id, l.status, pl.preco, pl.nome_plano, pr.nome AS produto
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
      WHERE l.tenant_id = $1 AND l.id = $2 AND LOWER(l.dados_conta->>'valor') = LOWER($3)`,
    [client.tenant_id, licencaId, ctx.emailOuId]
  );

  const licenca = rows[0];
  if (!licenca) {
    return send('Licença não encontrada para esta conta. Tente outro número ou "0" para cancelar.');
  }

  // Verificar se já existe um pagamento pendente para esta licença
  const pag = await query(
    `SELECT id, valor, paysuite_checkout_url FROM pagamentos 
      WHERE referencia_tipo = 'licenca' AND referencia_id = $1 AND status = 'pendente' 
      ORDER BY id DESC LIMIT 1`,
    [licencaId]
  );

  const descricao = `${licenca.produto} — ${licenca.nome_plano}`;
  let pagamentoId;
  let valor;

  if (pag.rows.length > 0) {
    // Reutilizar o pagamento pendente existente
    pagamentoId = pag.rows[0].id;
    valor = pag.rows[0].valor;
  } else {
    // Criar um NOVO pagamento para renovação
    valor = licenca.preco;
    const novoPag = await query(
      `INSERT INTO pagamentos (tenant_id, cliente_id, referencia_tipo, referencia_id, valor, moeda, status)
       VALUES ($1, $2, 'licenca', $3, $4, 'MZN', 'pendente') RETURNING id`,
      [client.tenant_id, client.id, licencaId, valor]
    );
    pagamentoId = novoPag.rows[0].id;
    console.log(`[ADMIN] Novo pagamento para renovação #${pagamentoId} da licença #${licencaId}`);
  }

  await setSession(client.id, "pagamento_metodo", {
    licencaId,
    pagamentoId,
    valor,
    descricao,
  });

  return abrirPaginaPagamento(client, pagamentoId, valor, descricao, send);
}

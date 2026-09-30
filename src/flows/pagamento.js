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

  const descricao = `${produto} — ${nome_plano}`;

  // Reutilizar o que já existe para esta conta e este plano, em vez de criar
  // uma licença nova de cada vez. Sem isto, cada nova tentativa (o cliente
  // reenvia a senha, clica duas vezes, ou o bot repete a pergunta) gerava
  // outra licença + outro pagamento + outro pedido na PaySuite — foi assim
  // que apareceram 17 cobranças iguais para a mesma pessoa.
  const existente = await query(
    `SELECT l.id AS licenca_id, p.id AS pagamento_id
       FROM licencas l
       JOIN pagamentos p
         ON p.referencia_tipo = 'licenca' AND p.referencia_id = l.id
      WHERE l.tenant_id = $1
        AND l.plano_id = $2
        AND l.status = 'pendente'
        AND LOWER(l.dados_conta->>'valor') = LOWER($3)
      ORDER BY p.id DESC
      LIMIT 1`,
    [client.tenant_id, planoId, conta.valor]
  );

  if (existente.rows.length > 0) {
    const { licenca_id: licencaId, pagamento_id: pagamentoId } = existente.rows[0];
    console.log(
      `[ADMIN] Reaproveitando licença #${licencaId} / pagamento #${pagamentoId} ` +
        `para ${produto} (conta ${conta.valor})`
    );

    await setSession(client.id, "pagamento_metodo", {
      licencaId,
      pagamentoId,
      valor,
      descricao,
    });

    return abrirPaginaPagamento(client, pagamentoId, valor, descricao, send);
  }

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

  // Já existe um pedido na PaySuite mas sem link guardado (resposta truncada,
  // gravacao falhada, etc.). Criar outro aqui produzia dozens de pedidos
  // duplicados para a mesma licenca. Recusamos e pedimos intervencao.
  if (existente && existente.paysuite_id) {
    console.error(
      `[PAYSUITE] pagamento #${pagamentoId} ja tem pedido ${existente.paysuite_id} mas sem link. ` +
        "Nao crio outro para nao duplicar a cobranca."
    );
    return send(
      `⚠️ Já existe um pedido de pagamento em aberto para *${descricao}*.\n\n` +
        "Não vou gerar outro para não lhe cobrar duas vezes. Fale com um atendente " +
        'e resolvemos já — escreva "5".'
    );
  }

  const base = baseUrl();
  try {
    const charge = await createPaySuiteCharge(valor, pagamentoId, {
      description: `Licenca ${descricao}`,
      webhookUrl: `${base}/admin/api/paysuite-webhook`,
      returnUrl: `${base}/admin`,
    });

    // Só gravamos o que é útil. Sem checkout_url não temos nada para enviar
    // ao cliente, portanto não registamos o pedido — caso contrário ficaria
    // "ocupado" sem link e o cliente nunca conseguiria pagar.
    if (charge.checkoutUrl) {
      await query(
        "UPDATE pagamentos SET paysuite_id = $2, paysuite_checkout_url = $3 WHERE id = $1",
        [pagamentoId, charge.id || null, charge.checkoutUrl]
      );
      return send(textoLinkPagamento(charge.checkoutUrl, descricao, valor, true));
    }

    return send(
      `🧾 *${descricao}* — ${formatMoney(valor)}\n\n` +
        "Não foi possível gerar a página de pagamento. Fale com um atendente:\n" +
        'Escreva "5" e resolvemos já.'
    );
  } catch (err) {
    console.error("[PAYSUITE] erro ao criar o pedido de pagamento:", err.message);
    // Credenciais da PaySuite erradas ou expiradas acontece sem aviso e
    // silencia o bot inteiro: o cliente vê uma mensagem de erro e desiste.
    // Avisamos o dono para que a falha seja vista antes de perder uma venda.
    if (/unauthenticated|forbidden|401|403/i.test(err.message)) {
      await avisarAdmin(
        `🚨 *PaySuite recusou o pedido*\n\n` +
          `O token da API da PaySuite foi recusado (${err.message}).\n\n` +
          `Nenhum cliente consegue concluir um pagamento até isto ser corrigido. ` +
          "Actualiza PAYSUITE_API_TOKEN no Vercel."
      );
    }
    return send(
      `⚠️ Não consegui abrir a página de pagamento: ${err.message}\n\n` +
        "Fale com um atendente para resolver:\n" +
        'Escreva "5".'
    );
  }
}

/**
 * Avisa o dono de uma falha técnica. Nunca deve interromper o fluxo do
 * cliente, por isso os erros são engolidos.
 */
async function avisarAdmin(texto) {
  const numeros = env.adminNumbers;
  if (!numeros.length) return;
  for (const numero of numeros) {
    try {
      await sendTextMessage(numero, texto);
    } catch (err) {
      console.error(`[PAYSUITE] não consegui avisar o dono (${numero}):`, err.message);
    }
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
    "💳 Vamos ver as suas licenças.\n\n" +
      "Escreva o *email*, o *ID de cliente* ou o número de licença que usa no sistema.\n\n" +
      'Escreva "0" para voltar.'
  );
}

export async function handlePagamentoBuscarConta(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const { rows } = await query(
    `SELECT l.id, l.status, l.data_expiracao,
            pl.nome_plano, pl.preco, pr.nome AS produto,
            pg.id AS pagamento_id, pg.status AS pagamento_status,
            pg.valor
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
       LEFT JOIN LATERAL (
         SELECT id, status, valor FROM pagamentos
          WHERE referencia_tipo = 'licenca' AND referencia_id = l.id
          ORDER BY id DESC LIMIT 1
       ) pg ON true
      WHERE l.tenant_id = $1
        AND ( LOWER(l.dados_conta->>'valor') = LOWER($2)
              OR l.id::text = $2 )
      ORDER BY l.id DESC`,
    [client.tenant_id, texto]
  );

  if (!rows.length) {
    return send(
      `Não encontrei nenhuma licença associada à conta "${texto}". 🔎\n\n` +
      'Tente novamente com outro email/ID ou escreva "0" para cancelar.'
    );
  }

  let msg = `💳 Licenças da conta *${texto}*:\n\n`;
  const licencasIds = [];

  for (const l of rows) {
    const valor = Number(l.preco) > 0 ? formatMoney(l.preco) : "sob consulta";

    msg += `*${l.id}.* ${l.produto || "?"} — ${l.nome_plano || "?"}\n`;
    msg += `    Preço: ${valor}\n`;

    if (l.status === "ativa" && l.data_expiracao) {
      msg += `    Estado: activa até ${new Date(l.data_expiracao).toISOString().slice(0, 10)}\n`;
    } else if (l.data_expiracao) {
      msg += `    Estado: ${l.status} (expirou a ${new Date(l.data_expiracao).toISOString().slice(0, 10)})\n`;
    } else {
      msg += `    Estado: ${l.status}\n`;
    }

    if (l.pagamento_id && l.pagamento_status === "pendente") {
      msg += `    Pagamento #${l.pagamento_id}: por pagar\n`;
    } else if (l.pagamento_id) {
      msg += `    Pagamento #${l.pagamento_id}: ${l.pagamento_status}\n`;
    }

    msg += "\n";
    if (!licencasIds.includes(l.id)) licencasIds.push(l.id);
  }

  msg +=
    "Escolha o número da licença que quer pagar ou renovar:\n" +
    `(${licencasIds.join(", ")})\n\n` +
    'Escreva "0" para voltar.';

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
    `SELECT l.id, l.status, l.data_expiracao, pl.preco, pl.nome_plano, pr.nome AS produto
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
      WHERE l.tenant_id = $1 AND l.id = $2
        AND ( LOWER(l.dados_conta->>'valor') = LOWER($3)
              OR l.id::text = $3 )`,
    [client.tenant_id, licencaId, ctx.emailOuId]
  );

  const licenca = rows[0];
  if (!licenca) {
    return send('Licença não encontrada para esta conta. Tente outro número ou "0" para cancelar.');
  }

  const descricao = `${licenca.produto} — ${licenca.nome_plano}`;

  // Antes de propor uma cobrança, perguntamos à PaySuite se algum pedido
  // anterior desta licença já foi pago. Sem isto, um cliente que pagou mas
  // não recebeu a confirmação podia ser cobrado uma segunda vez.
  const pago = await confirmarSeJaPago(licencaId);
  if (pago && pago.ok) {
    return send(
      `✅ *O seu pagamento já estava confirmado!*\n\n` +
        `${descricao}\n` +
        (pago.data_expiracao
          ? `A licença está activa até ${pago.data_expiracao.slice(0, 10)}.\n`
          : "") +
        "\nNão é necessário pagar novamente."
    );
  }

  // Licença ainda activa: avisamos e deixamos a decisão ao cliente. Não
  // bloqueamos — renovar antecipadamente é legítimo.
  if (licenca.status === "ativa" && licenca.data_expiracao) {
    const expira = new Date(licenca.data_expiracao);
    if (expira > new Date()) {
      console.log(
        `[ADMIN] #${licencaId} ainda activa até ${expira.toISOString().slice(0, 10)} — a perguntar ao cliente`
      );
      await setSession(client.id, "pagamento_confirmar_renovacao", {
        licencaId,
        emailOuId: ctx.emailOuId,
        ate: expira.toISOString(),
      });
      return send(
        `ℹ️ Esta licença já está *activa* até ${expira.toISOString().slice(0, 10)}.\n\n` +
          `*${descricao}* — ${formatMoney(licenca.preco)}\n\n` +
          'Quer renovar mesmo assim? Responda "sim" para continuar, ou "0" para voltar.'
      );
    }
  }

  return criarPagamentoParaLicenca(client, licenca, descricao, send);
}

/**
 * Confirma com a PaySuite se algum pedido anterior desta licença já foi
 * pago. Devolve o resultado de confirmarPagamento() ou null se não houver
 * pedido pago.
 */
async function confirmarSeJaPago(licencaId) {
  const anteriores = await query(
    `SELECT paysuite_id FROM pagamentos
      WHERE referencia_tipo = 'licenca' AND referencia_id = $1 AND paysuite_id IS NOT NULL
      ORDER BY id DESC LIMIT 5`,
    [licencaId]
  );

  for (const ant of anteriores.rows) {
    let estado = "";
    try {
      const s = await getPaySuiteCharge(String(ant.paysuite_id));
      estado = String(s.status || (s.transaction && s.transaction.status) || "").toLowerCase();
    } catch (err) {
      // A PaySuite não respondeu — não arriscamos dizer que está pago.
      console.error(`[PAYSUITE] não consegui ler o pedido ${ant.paysuite_id}:`, err.message);
      continue;
    }
    if (ESTADOS_PAGOS.has(estado)) {
      // O dinheiro já entrou mas o webhook não activou a licença.
      // Confirmamos em vez de cobrar outra vez.
      const r = await confirmarPagamento(String(ant.paysuite_id));
      if (r.ok) return r;
    }
  }
  return null;
}

/**
 * Cria (ou reutiliza) o pagamento de uma licença e envia a página de
 * checkout. O valor vem sempre do plano — nunca de um valor enviado pelo
 * cliente.
 */
async function criarPagamentoParaLicenca(client, licenca, descricao, send) {
  const licencaId = licenca.id;

  // Se já existe um pagamento pendente, reutiliza-se em vez de duplicar.
  const pag = await query(
    `SELECT id, valor FROM pagamentos
      WHERE referencia_tipo = 'licenca' AND referencia_id = $1 AND status = 'pendente'
      ORDER BY id DESC LIMIT 1`,
    [licencaId]
  );

  let pagamentoId;
  let valor;

  if (pag.rows.length > 0) {
    pagamentoId = pag.rows[0].id;
    valor = pag.rows[0].valor;
  } else {
    valor = licenca.preco;
    const novoPag = await query(
      `INSERT INTO pagamentos (tenant_id, cliente_id, referencia_tipo, referencia_id, valor, moeda, status)
       VALUES ($1, $2, 'licenca', $3, $4, 'MZN', 'pendente') RETURNING id`,
      [client.tenant_id, client.id, licencaId, valor]
    );
    pagamentoId = novoPag.rows[0].id;
    console.log(`[ADMIN] Novo pagamento #${pagamentoId} para a licença #${licencaId}`);
  }

  await setSession(client.id, "pagamento_metodo", {
    licencaId,
    pagamentoId,
    valor,
    descricao,
  });

  return abrirPaginaPagamento(client, pagamentoId, valor, descricao, send);
}

/**
 * O cliente respondeu "sim" à pergunta de renovação antecipada.
 */
export async function handlePagamentoConfirmarRenovacao(client, ctx, text, send) {
  const resposta = text.trim().toLowerCase();

  if (resposta === "0" || COMANDOS_MENU.includes(resposta)) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  if (!["sim", "s", "yes", "y", "ok"].includes(resposta)) {
    return send('Responda "sim" para renovar ou "0" para voltar.');
  }

  const { rows } = await query(
    `SELECT l.id, l.status, l.data_expiracao, pl.preco, pl.nome_plano, pr.nome AS produto
       FROM licencas l
       LEFT JOIN planos pl ON pl.id = l.plano_id
       LEFT JOIN produtos pr ON pr.id = pl.produto_id
      WHERE l.tenant_id = $1 AND l.id = $2
        AND ( LOWER(l.dados_conta->>'valor') = LOWER($3)
              OR l.id::text = $3 )`,
    [client.tenant_id, ctx.licencaId, ctx.emailOuId]
  );

  const licenca = rows[0];
  if (!licenca) {
    await setSession(client.id, "menu", {});
    return send('Licença não encontrada. Escreva "menu" para voltar.');
  }

  return criarPagamentoParaLicenca(
    client,
    licenca,
    `${licenca.produto} — ${licenca.nome_plano}`,
    send
  );
}

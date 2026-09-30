import { query, getTenantById } from "../services/dbService.js";
import { setSession } from "../services/sessionService.js";
import {
  ativarLicenca,
  consultarLicencaSaaS,
  listarPlanosSaaS,
  getSistemaChave,
  SISTEMA_LABEL,
  temConector,
} from "../services/saasService.js";
import { createPaySuiteCharge, getPaySuiteCharge } from "../services/paysuiteService.js";
import { sendTextMessage } from "../services/metaApi.js";
import { falarComHumano } from "./humano.js";
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
  const { planoId, preco, produto, nome_plano, saasUser, hefelgymId, saasPlano } = ctx;
  const valor = Number(ctx.valor ?? preco);

  const conta = hefelgymId
    ? { tipo: "id_ginasio", valor: hefelgymId }
    : { tipo: "email", valor: saasUser };
  // O slug e o nome do produto travelham com a licença: um plano lido da
  // base de dados do cliente não existe na tabela `planos` do bot, e sem isto
  // a confirmação do pagamento não saberia que sistema activar.
  if (saasPlano) conta.saasPlano = saasPlano;
  conta.nome_plano = nome_plano;
  conta.produtoCatalogo = produto;

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
        AND l.status = 'pendente'
        AND LOWER(l.dados_conta->>'valor') = LOWER($2)
        AND (
          ($3::int IS NOT NULL AND l.plano_id = $3)
          OR ($3::int IS NULL AND l.dados_conta->>'saasPlano' = $4)
        )
      ORDER BY p.id DESC
      LIMIT 1`,
    [client.tenant_id, conta.valor, planoId ?? null, saasPlano || null]
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
          "Actualiza PAYSUITE_API_TOKEN no Vercel.",
        client.tenant_id
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
 * Envia um aviso ao dono usando o token do tenant.
 *
 * O token do ambiente (WHATSAPP_TOKEN) pode estar expirado — o token do
 * tenant é o que está garantido. Sem isto, os avisos de venda e de falha
 * não saíam e ninguém vê o problema.
 */
async function enviarAoDono(texto, tenantId) {
  const numeros = env.adminNumbers;
  if (!numeros.length) return;
  const tenant = tenantId ? await getTenantById(tenantId) : null;
  for (const numero of numeros) {
    try {
      await sendTextMessage(numero, texto, tenant);
    } catch (err) {
      console.error(`[PAYSUITE] não consegui avisar o dono (${numero}):`, err.message);
    }
  }
}

/**
 * Avisa o dono de uma falha técnica. Nunca deve interromper o fluxo do
 * cliente, por isso os erros são engolidos.
 */
async function avisarAdmin(texto, tenantId) {
  await enviarAoDono(texto, tenantId);
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
 * Escolha do plano (opção 2): em vez de criar logo o pagamento, entramos no
 * mesmo fluxo da opção 3 — o cliente dá os dados, vemos a licença que ele
 * tem hoje no sistema e ele escolhe o que quer pagar.
 *
 * Antes isto perguntava email e depois a senha. A senha não provava nada
 * (a PaySuite não a valida) e só acrescentava um passo ao cliente.
 */
export async function handlePlanoContratar(client, ctx, text, send) {
  const planos = ctx.planos || [];
  const n = parseInt(text.trim(), 10);
  if (!n || n < 1 || n > planos.length) {
    return send('Escolha um número válido do plano, ou "0" para voltar.');
  }
  const planoId = planos[n - 1];

  const { rows } = await query(
    `SELECT pl.id, pl.nome_plano, pl.preco, pl.produto_id, pr.nome AS produto
       FROM planos pl JOIN produtos pr ON pr.id = pl.produto_id
      WHERE pl.id = $1 AND pl.tenant_id = $2`,
    [planoId, client.tenant_id]
  );
  const plano = rows[0];
  if (!plano) {
    await setSession(client.id, "menu", {});
    return send('Plano não encontrado. Escreva "menu" para voltar.');
  }

  await setSession(client.id, "pagamento_dados_conta", {
    produtoId: plano.produto_id,
    produto: plano.produto,
  });

  return send(
    `Escolheu *${rotuloSistema(plano.produto)} — ${plano.nome_plano}* ` +
      `(${formatMoney(plano.preco)}/mês).\n\n` +
      "Agora preciso dos *seus dados* para ver a sua licença actual.\n\n" +
      "Escreva o *email* com que a sua conta está registada no sistema" +
      (sistemaDe(plano.produto) === "GYMAR" ? ", ou o seu *nome / ID de cliente*" : "") +
      ":\n\n" +
      'Escreva "0" para voltar.'
  );
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
    `SELECT p.id, p.tenant_id, p.cliente_id, p.referencia_id, p.valor, p.status,
            l.plano_id, l.status AS licenca_status, l.data_expiracao, l.dados_conta,
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

  // Quando o plano veio da base de dados do sistema do cliente não existe
  // linha na tabela `planos` do bot, por isso produto e plano são lidos de
  // dados_conta. Sem isto a renovação no sistema do cliente não sabia nem
  // qual sistema nem qual conta activar.
  const dadosLic = pagamento.dados_conta || {};
  const produtoPagamento = pagamento.produto || dadosLic.produtoCatalogo || null;
  const planoPagamento = pagamento.nome_plano || dadosLic.nome_plano || null;

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
    if (dados && dados.valor && (produtoPagamento || pagamento.produto)) {
      const prod = produtoPagamento || pagamento.produto;
      const planoNom = planoPagamento || pagamento.nome_plano;
      // O slug lido da base do cliente tem prioridade sobre o mapa local:
      // é o plano que ele escolheu e que existe lá dentro.
      const slugReal = dados.saasPlano || slugDoPlano(prod, planoNom);
      noSaas = await ativarLicenca(prod, dados.valor, 1, slugReal);
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
    produto: pagamento.produto || produtoPagamento,
    plano: pagamento.nome_plano || planoPagamento,
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
      await sendTextMessage(numero, texto, await getTenantById(pagamento.tenant_id));
    } catch (err) {
      console.error(`[PAGAMENTO] não consegui avisar o dono (${numero}):`, err.message);
    }
  }
}

/**
 * O nome do plano no bot não é o slug do plano no sistema do cliente
 * ("moz teles" aqui é "moztele" lá dentro). Sem esta tradução a conta do
 * Armazém era renovada mantendo o plano antigo, mesmo quando o cliente tinha
 * escolhido outro no WhatsApp.
 *
 * Se o slug não estiver na lista, devolve null: é melhor renovar o plano
 * actual do que escrever um plano errado na conta do cliente.
 */
const SLUGS_ARMAZEM = {
  moztele: "moztele",
  "mozteles": "moztele",
  interno: "interno",
  "controlo interno": "interno",
  "plano controlo interno": "interno",
  "3pl": "3pl",
};

function slugDoPlano(produtoNome, nomePlano) {
  if (getSistemaChave(produtoNome) !== "ARMAZEM") return null;
  const chave = String(nomePlano || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
  return SLUGS_ARMAZEM[chave] || null;
}

async function clienteWhatsapp(clienteId) {
  const r = await query("SELECT whatsapp_number FROM clientes WHERE id = $1", [clienteId]);
  return r.rows[0] ? r.rows[0].whatsapp_number : null;
}
/* =========================================================================
 * FLUXO DE PAGAMENTO (opcao 3 do menu)
 *
 * O cliente escolhe primeiro o SISTEMA, depois da os seus dados, e o bot
 * responde com a licenca que a pessoa esta a usar de facto (plano e data de
 * expiracao, lidos do sistema real) e da opcoes de escolha.
 * Nunca e mostrado "pagamento pendente" ao cliente.
 *
 *   pagamento_escolher_produto -> pagamento_dados_conta
 *   -> pagamento_escolher_opcao -> pagamento_escolher_plano -> pagamento_metodo
 * ========================================================================= */

function sistemaDe(nomeProduto) {
  return getSistemaChave(nomeProduto);
}

function rotuloSistema(nomeProduto) {
  return SISTEMA_LABEL[sistemaDe(nomeProduto)] || nomeProduto;
}

function dataCurta(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function diasTexto(dias) {
  if (dias === null || dias === undefined) return "";
  if (dias < 0) return " — *ja expirou*";
  if (dias === 0) return " — *expira hoje*";
  if (dias === 1) return " — expira amanha";
  return ` — faltam ${dias} dias`;
}

async function planosDoProduto(tenantId, produtoId, { incluirOcultos = false } = {}) {
  const { rows } = await query(
    `SELECT id, nome_plano, preco
       FROM planos
      WHERE tenant_id = $1 AND produto_id = $2 AND ativo = true
      ORDER BY preco, nome_plano`,
    [tenantId, produtoId]
  );
  if (incluirOcultos) return rows;
  // "moz teles" é um pacote reservado (Moz Tele). Aparece no catálogo público
  // só quando é o plano que a conta já tem — nunca como opção avulsa.
  return rows.filter((p) => p.nome_plano.toLowerCase() !== "moz teles");
}

/** Opcao 3 do menu — escolher em que sistema quer pagar. */
export async function showPagamento(client, send) {
  // TODOS os sistemas activos. Quem ainda não tem preço no bot aparece na
  // mesma e, ao ser escolhido, passa para um atendente — escondê-lo fazia o
  // cliente pensar que o sistema não existia.
  const { rows } = await query(
    `SELECT pr.id, pr.nome,
            count(pl.id) FILTER (WHERE pl.ativo)::int AS planos_ativos
       FROM produtos pr
       LEFT JOIN planos pl ON pl.tenant_id = $1 AND pl.produto_id = pr.id
      WHERE pr.tenant_id = $1 AND pr.ativo = true
      GROUP BY pr.id, pr.nome
      ORDER BY pr.nome`,
    [client.tenant_id]
  );

  await setSession(client.id, "pagamento_escolher_produto", {
    produtoIds: rows.map((r) => r.id),
    produtoNomes: rows.map((r) => r.nome),
    produtoComPreco: rows.map((r) => Number(r.planos_ativos) > 0),
  });

  const marcador = (r) => {
    if (Number(r.planos_ativos) === 0) return " 💬";
    return temConector(r.nome) ? " 📖" : "";
  };
  const lista = rows.map((r, i) => `${i + 1}. ${r.nome}${marcador(r)}`).join("\n");

  return send(
    "💳 *Licença e pagamento*\n\n" +
      "Primeiro: em que *sistema* quer pagar?\n\n" +
      `${lista}\n\n` +
      "📖 = dizemos-lhe o plano e a validade que tem hoje.\n" +
      "💬 = fale com um atendente (ainda sem preço no bot).\n\n" +
      'Responda com o *número*. Escreva "0" para voltar.'
  );
}

export async function handlePagamentoEscolherProduto(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const idx = parseInt(texto, 10) - 1;
  const nome = ctx.produtoNomes && ctx.produtoNomes[idx];
  if (!nome) return send('Escolha um número da lista, ou "0" para voltar.');

  const planos = await planosDoProduto(client.tenant_id, ctx.produtoIds[idx]);
  if (!planos.length) {
    // Sem preço no bot: não inventamos um valor nem deixamos o cliente num
    // beco sem saída — passa para um atendente.
    await falarComHumano(
      client,
      async (t) =>
        send(
          `*${nome}* ainda não tem preço definido aqui no bot. ` +
            "Vou passar-lhe a um atendente para tratar disso.\n\n" + t
        ),
      await getTenantById(client.tenant_id)
    );
    return;
  }

  await setSession(client.id, "pagamento_dados_conta", {
    produtoId: ctx.produtoIds[idx],
    produto: nome,
  });

  return send(
    `Escolheu *${nome}* 👍\n\n` +
      "Agora preciso dos *seus dados* para ver a sua licença actual.\n\n" +
      "Escreva o *email* com que a sua conta está registada no sistema" +
      (sistemaDe(nome) === "GYMAR" ? ", ou o seu *nome / ID de cliente*" : "") +
      ":\n\n" +
      'Escreva "0" para voltar.'
  );
}

export async function handlePagamentoDadosConta(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }
  if (texto.length < 3) {
    return send(
      'Esse dado parece incompleto. Escreva o *email* da sua conta, ou "0" para voltar.'
    );
  }

  const novoCtx = { ...ctx, conta: texto };
  await setSession(client.id, "pagamento_escolher_opcao", novoCtx);
  return mostrarOpcoesLicenca(client, novoCtx, send);
}

/**
 * Responde com a licenca REAL da conta (plano + validade, lidos do sistema)
 * e com as opcoes de escolha. Nunca bloqueia a venda: se nao souber ler,
 * mostra os planos na mesma.
 */
async function mostrarOpcoesLicenca(client, ctx, send) {
  const lic = await consultarLicencaSaaS(ctx.produto, ctx.conta);

  let cabecalho;
  if (lic.semConector) {
    cabecalho =
      `ℹ️ Em *${rotuloSistema(ctx.produto)}* não temos leitura automática da sua licença.\n\n`;
  } else if (lic.contaNaoEncontrada) {
    cabecalho =
      `🔎 Não encontrei a conta *"${ctx.conta}"* em *${rotuloSistema(ctx.produto)}*.\n` +
      `Procuramos pelo ${lic.campo === "nome ou id" ? "nome ou ID" : "email"}. Verifique o dado e escreva-o outra vez.\n\n`;
  } else if (!lic.ok) {
    cabecalho =
      "⚠️ Não consegui ler a sua licença no sistema neste momento.\n\n" +
      "Se já renovou e o erro continuar, fale com um atendente.\n\n";
  } else {
    const linhas = [`👤 *${lic.nome}*`];
    if (lic.plano) linhas.push(`📦 Plano actual: *${lic.plano}*`);
    linhas.push(`📅 Válido até *${dataCurta(lic.validade)}*${diasTexto(lic.dias)}`);
    cabecalho =
      `✅ *Conta encontrada em ${rotuloSistema(ctx.produto)}*\n\n${linhas.join("\n")}\n\n`;
  }

  // Incluídos os planos ocultos: é assim que o "moz teles" reservado é
  // encontrado quando é o plano que a conta já tem.
  const { origem: origemPlanos, planos } = await planosDisponiveis(client, ctx, { incluirOcultos: true });
  const planoCliente = lic.ok
    ? planoQueCorresponde(planos, lic.planoSlug, lic.plano, lic.precoSugerido)
    : null;
  const precoCliente = planoCliente ? planoCliente.preco : lic.precoSugerido || null;

  const opcoes = [];
  if (planoCliente) {
    opcoes.push({
      accao: "pagar",
      rotulo: `*Renovar* ${planoCliente.nome_plano} — ${formatMoney(planoCliente.preco)}/mês`,
    });
    cabecalho += `💰 Renovação: ${formatMoney(planoCliente.preco)}/mês.\n\n`;
  } else if (precoCliente) {
    cabecalho += `💰 O seu plano actual custa ${formatMoney(precoCliente)}/mês.\n\n`;
  }
  opcoes.push({ accao: "planos", rotulo: "Ver *planos* e preços" });
  opcoes.push({ accao: "humano", rotulo: "Falar com um *atendente*" });

  await setSession(client.id, "pagamento_escolher_opcao", {
    ...ctx,
    origemPlanos,
    planoCliente: planoCliente || null,
    opcoes: opcoes.map((o) => o.accao),
  });

  return send(
    cabecalho +
      "O que deseja fazer?\n\n" +
      opcoes.map((o, i) => `${i + 1}. ${o.rotulo}`).join("\n") +
      '\n\nResponda com o *número*, ou "0" para voltar.'
  );
}

/** Encontra o plano do catalogo que corresponde ao slug/nome que o cliente tem. */
function planoQueCorresponde(planos, planoSlug, planoNome, precoReal = null) {
  const alvo = String(planoSlug || planoNome || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!alvo) return null;

  const chave = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // A correspondência é por ordem de confiança. A ordem importa: no Xonguile
  // "Premium" (6112) e "Premium Especial" (2223) partilham o início do nome.
  // Com um único `find` ganhava o nome mais comprado, o plano não batia com
  // o preço da conta e a renovação acabava bloqueada sem explicação.
  const porSlug = planos.find((p) => p.slug && chave(p.slug) === alvo);
  if (porSlug) return porSlug;

  const porNomeExacto = planos.find((p) => chave(p.nome_plano || p.nome) === alvo);
  if (porNomeExacto) return porNomeExacto;

  // Prefixos: o nome mais curto que ainda serve é o melhor candidato
  // ("Premium" para "Premium", não "Premium Especial").
  const porPrefixo = planos
    .filter((p) => {
      const n = chave(p.nome_plano || p.nome);
      return n.startsWith(alvo) || alvo.startsWith(n);
    })
    .sort((a, b) => chave(a.nome_plano || a.nome).length - chave(b.nome_plano || b.nome).length)[0];
  if (!porPrefixo) return null;

  // Plano parecido mas com preço muito diferente é outro plano. Cobrar o valor
  // errado em silêncio é pior do que não propor a renovação: devolvemos null
  // e o cliente vê a diferença antes de escolher.
  if (precoReal && Number.isFinite(Number(precoReal))) {
    const dif = Math.abs(Number(porPrefixo.preco) - Number(precoReal)) / Number(precoReal);
    if (dif > 0.05) return null;
  }
  return porPrefixo;
}

export async function handlePagamentoEscolherOpcao(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const n = parseInt(texto, 10);
  const accao = ctx.opcoes && ctx.opcoes[n - 1];
  if (!accao) return send('Escolha um número da lista, ou "0" para voltar.');

  if (accao === "humano") {
    // Sem o tenant, o aviso ao dono sairia com o WHATSAPP_TOKEN do ambiente,
    // que pode estar expirado. O token do tenant é o que funciona.
    return falarComHumano(client, send, await getTenantById(client.tenant_id));
  }
  if (accao === "planos") return mostrarPlanos(client, ctx, send);

  // O plano que a conta já tem foi resolvido a partir dos planos reais do
  // sistema, por isso pode não ter id do catálogo — é só servir a sessão.
  const plano = ctx.planoCliente;
  if (!plano) return mostrarPlanos(client, ctx, send);

  return abrirPagamentoParaPlano(client, ctx, plano, send);
}

/**
 * Impede cobrar um plano que não existe no sistema do cliente.
 *
 * O catálogo do bot e o catálogo do Smart Warehouse não são o mesmo: lá
 * dentro os planos são moztele (3000), interno (3500) e 3pl (5000). Se o
 * cliente escolhesse um plano do catálogo que não tiver slug conhecido, a
 * conta continuava no plano antigo e o valor cobrado não correspondia a
 * nada — por isso paramos aqui e passamos para um atendente.
 */
async function planoExisteNoCliente(produto, nomePlano) {
  const sistema = sistemaDe(produto);
  if (sistema !== "ARMAZEM") return true;
  return Boolean(slugDoPlano(produto, nomePlano));
}

/**
 * Planos que o cliente pode escolher agora.
 *
 * Primeiro lemos da base de dados do sistema escolhido — aí estão os planos
 * e os preços verdadeiros. Só quando o sistema não tem base configurada é que
 * se usa o catálogo do bot, que é genérico.
 */
async function planosDisponiveis(client, ctx, { incluirOcultos = false } = {}) {
  let reais = null;
  try {
    reais = await listarPlanosSaaS(ctx.produto);
  } catch (err) {
    console.warn("[PAGAMENTO] não conseguiu ler planos reais:", err.message);
  }

  if (reais && reais.ok && reais.planos.length) {
    return {
      origem: "saas",
      sistema: reais.sistema,
      planos: reais.planos
        .filter((p) => incluirOcultos || p.publico)
        .map((p) => ({ id: null, slug: p.slug, nome_plano: p.nome, preco: p.preco })),
    };
  }

  return {
    origem: "catalogo",
    planos: (await planosDoProduto(client.tenant_id, ctx.produtoId, { incluirOcultos })).map((p) => ({
      id: p.id,
      slug: null,
      nome_plano: p.nome_plano,
      preco: p.preco,
    })),
  };
}

async function mostrarPlanos(client, ctx, send, prefixo = "") {
  const { origem, planos } = await planosDisponiveis(client, ctx);
  if (!planos.length) return send("Não há planos disponíveis para este sistema.");

  await setSession(client.id, "pagamento_escolher_plano", {
    produtoId: ctx.produtoId,
    produto: ctx.produto,
    conta: ctx.conta,
    origemPlanos: origem,
  });

  return send(
    (prefixo ? prefixo + "\n\n" : "") +
      `📦 *Planos de ${rotuloSistema(ctx.produto)}*\n\n` +
      planos
        .map((p, i) => `${i + 1}. *${p.nome_plano}* — ${formatMoney(p.preco)}/mês`)
        .join("\n") +
      '\n\nResponda com o *número* do plano, ou "0" para voltar.'
  );
}

export async function handlePagamentoEscolherPlano(client, ctx, text, send) {
  const texto = text.trim();
  if (texto === "0" || COMANDOS_MENU.includes(texto.toLowerCase())) {
    await setSession(client.id, "menu", {});
    return send("Operação cancelada. Voltamos ao menu principal.");
  }

  const { planos } = await planosDisponiveis(client, ctx);
  const plano = planos[parseInt(texto, 10) - 1];
  if (!plano) return send('Escolha um número válido da lista, ou "0" para voltar.');

  return abrirPagamentoParaPlano(client, ctx, plano, send);
}

async function abrirPagamentoParaPlano(client, ctx, plano, send) {
  // Um plano lido da base de dados do cliente é, por definição, um plano que
  // existe lá dentro: não há o que validar contra o catálogo.
  if (plano.id !== null && plano.id !== undefined) {
    if (!(await planoExisteNoCliente(ctx.produto, plano.nome_plano))) {
      console.error(
        `[PAGAMENTO] plano "${plano.nome_plano}" de "${ctx.produto}" não existe no sistema do cliente — venda bloqueada`
      );
      await avisarAdmin(
        `🚫 *Venda bloqueada*\n\n` +
          `O plano *${plano.nome_plano}* do catálogo não existe no sistema ` +
          `*${rotuloSistema(ctx.produto)}*.\n\n` +
          `Cliente: ${client.whatsapp_number}\n` +
          `Alinhe o catálogo com os planos reais antes de o vender.`,
        client.tenant_id
      );
      return falarComHumano(client, send, await getTenantById(client.tenant_id));
    }
  }

  return criarLicencaEAbrirPagina(
    client,
    {
      planoId: plano.id ?? null,
      preco: plano.preco,
      valor: plano.preco,
      produto: rotuloSistema(ctx.produto),
      nome_plano: plano.nome_plano,
      saasUser: ctx.conta,
      saasPlano: plano.slug,
    },
    send
  );
}

import { setSession } from "../services/sessionService.js";
import {
  SISTEMAS_LICENCA_CASH,
  procurarContasLicencaCash,
} from "../services/saasService.js";
import {
  aplicarLicencaCash,
  dataCashValida,
} from "../services/licencaCashService.js";

const SISTEMAS_POR_NUMERO = {
  1: "CAFEPOINT",
  2: "XONGUILE",
  3: "GESTORFARMA",
  4: "ARMAZEM",
};

const CANCELAR = ["cancelar", "voltar", "sair", "terminar"];

function formatMoney(valor) {
  const n = Number(valor);
  if (Number.isNaN(n)) return String(valor);
  return (
    n.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    " MZN"
  );
}

function isoLocal(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function inicioDoDia() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

/**
 * Base para o "+30": usa a validade actual se ainda estiver no futuro; se já
 * expirou (ou não houver data), conta a partir de hoje.
 */
function dataBase(validadeAtual) {
  if (validadeAtual) {
    const d = new Date(`${validadeAtual}T00:00:00`);
    if (!Number.isNaN(d.getTime()) && d >= inicioDoDia()) return d;
  }
  return inicioDoDia();
}

function somarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return isoLocal(d);
}

function cancelado(text) {
  return CANCELAR.includes(String(text || "").trim().toLowerCase());
}

async function cancelar(client, send) {
  await setSession(client.id, "menu", {});
  return send('Operação cancelada. Escreva "menu" para voltar ao menu principal.');
}

function menuSistemas() {
  return (
    "💵 *Licenças Cash*\n\n" +
    "Em que sistema quer actualizar a licença?\n\n" +
    "1. Cafe Point\n" +
    "2. Salaoapp / Xonguile\n" +
    "3. GestorFarma\n" +
    "4. Armazém\n\n" +
    'Responda com o *número*. Escreva "0" para cancelar.'
  );
}

export function startLicencaCash(send) {
  return send(menuSistemas());
}

export async function handleCashSistema(client, ctx, text, send) {
  if (cancelado(text)) return cancelar(client, send);

  const sistema = SISTEMAS_POR_NUMERO[parseInt(text.trim(), 10)];
  if (!sistema) {
    return send('Escolha um número de 1 a 4, ou "0" para cancelar.\n\n' + menuSistemas());
  }

  await setSession(client.id, "cash_nome", { sistema });
  return send(
    `Sistema: *${SISTEMAS_LICENCA_CASH[sistema]}*\n\n` +
      "Escreva o *nome do tenant/cliente* (pelo menos 2 letras).\n\n" +
      'Escreva "0" para cancelar.'
  );
}

export async function handleCashNome(client, ctx, text, send) {
  if (cancelado(text)) return cancelar(client, send);

  const nome = text.trim();
  if (nome.length < 2) {
    return send('Escreva pelo menos 2 letras do nome, ou "0" para cancelar.');
  }

  let contas;
  try {
    contas = await procurarContasLicencaCash(ctx.sistema, nome);
  } catch (err) {
    console.error("[CASH] erro na procura:", err.message);
    return send(`❌ Não consegui procurar em ${SISTEMAS_LICENCA_CASH[ctx.sistema]}: ${err.message}`);
  }

  if (!contas.length) {
    return send(
      `Não encontrei nenhuma conta com *"${nome}"* em ` +
        `*${SISTEMAS_LICENCA_CASH[ctx.sistema]}*.\n\n` +
        'Escreva outro nome, ou "0" para cancelar.'
    );
  }

  await setSession(client.id, "cash_conta", { sistema: ctx.sistema, contas });

  if (contas.length === 1) {
    const c = contas[0];
    return send(
      `Encontrei:\n\n` +
        `👤 *${c.nome}*\n` +
        `📧 ${c.email || "sem email"}\n` +
        `📅 Data-fim actual: *${c.data_fim || "sem data"}*\n\n` +
        "1. Confirmar esta conta\n" +
        "2. Procurar outro nome\n\n" +
        'Responda com o número, ou "0" para cancelar.'
    );
  }

  const lista = contas
    .map(
      (c, i) =>
        `${i + 1}. *${c.nome}* — ${c.email || "sem email"} ` +
        `(actual: ${c.data_fim || "sem data"})`
    )
    .join("\n");

  return send(
    `Encontrei ${contas.length} contas em *${SISTEMAS_LICENCA_CASH[ctx.sistema]}*:\n\n` +
      `${lista}\n\n` +
      'Responda com o *número* da conta, ou "0" para cancelar.'
  );
}

export async function handleCashConta(client, ctx, text, send) {
  if (cancelado(text)) return cancelar(client, send);

  const contas = ctx.contas || [];
  const n = parseInt(text.trim(), 10);

  let conta = null;

  if (contas.length === 1) {
    if (n === 1) conta = contas[0];
    else if (n === 2) {
      await setSession(client.id, "cash_nome", { sistema: ctx.sistema });
      return send('Escreva o nome do tenant/cliente, ou "0" para cancelar.');
    } else {
      return send('Responda 1 para confirmar a conta, 2 para procurar outro nome, ou "0" para cancelar.');
    }
  } else {
    conta = contas[n - 1] || null;
    if (!conta) {
      return send('Escolha um número da lista, ou "0" para cancelar.');
    }
  }

  await setSession(client.id, "cash_data", { sistema: ctx.sistema, conta });

  return send(
    `Conta: *${conta.nome}* — ${conta.email || "sem email"}\n` +
      `Data-fim actual: *${conta.data_fim || "sem data"}*\n\n` +
      "Qual é a *nova data-fim*?\n\n" +
      "• Escreva a data no formato *AAAA-MM-DD* (ex.: 2026-12-31)\n" +
      "• Ou *+30*, *+60*, *+90*, *+365* para somar dias à validade actual\n\n" +
      'Escreva "0" para cancelar.'
  );
}

export async function handleCashData(client, ctx, text, send) {
  if (cancelado(text)) return cancelar(client, send);

  const entrada = text.trim().toLowerCase();
  let dataFim = null;

  const soma = entrada.match(/^\+(\d{1,4})$/);
  if (soma) {
    const dias = parseInt(soma[1], 10);
    if (dias < 1 || dias > 3650) {
      return send("Indique entre +1 e +3650 dias, ou uma data AAAA-MM-DD.");
    }
    dataFim = somarDias(dataBase(ctx.conta.data_fim), dias);
  } else if (dataCashValida(entrada)) {
    dataFim = entrada;
  } else {
    return send(
      "Data inválida. Escreva no formato *AAAA-MM-DD* (ex.: 2026-12-31) " +
        "ou *+30* para somar 30 dias."
    );
  }

  await setSession(client.id, "cash_valor", {
    sistema: ctx.sistema,
    conta: ctx.conta,
    dataFim,
  });

  return send(
    `Nova data-fim: *${dataFim}*.\n\n` +
      "Valor pago em MZN (opcional).\n" +
      "Escreva o valor (ex.: 3900) ou *0* para não indicar."
  );
}

export async function handleCashValor(client, ctx, text, send) {
  if (cancelado(text)) return cancelar(client, send);

  const entrada = text.trim().replace(",", ".");
  let valor = null;

  if (entrada !== "0" && entrada !== "") {
    const n = Number(entrada);
    if (!Number.isFinite(n) || n < 0) {
      return send('Valor inválido. Escreva um número (ex.: 3900) ou *0* para não indicar.');
    }
    valor = n;
  }

  await setSession(client.id, "cash_confirmar", {
    sistema: ctx.sistema,
    conta: ctx.conta,
    dataFim: ctx.dataFim,
    valor,
  });

  const c = ctx.conta;
  return send(
    "📋 *Confirmar actualização?*\n\n" +
      `Sistema: *${SISTEMAS_LICENCA_CASH[ctx.sistema]}*\n` +
      `Cliente: *${c.nome}*\n` +
      `Email: ${c.email || "sem email"}\n` +
      `Data-fim actual: *${c.data_fim || "sem data"}*\n` +
      `Nova data-fim: *${ctx.dataFim}*\n` +
      `Valor pago: ${valor !== null ? formatMoney(valor) : "não indicado"}\n\n` +
      "1. Confirmar e emitir talão\n" +
      "0. Cancelar"
  );
}

export async function handleCashConfirmar(client, ctx, text, send) {
  const resposta = String(text || "").trim().toLowerCase();
  const confirmou = ["1", "sim", "confirmar", "confirmo"].includes(resposta);

  if (!confirmou) {
    await setSession(client.id, "menu", {});
    return send('Operação cancelada. Nenhuma licença foi alterada.');
  }

  try {
    const recibo = await aplicarLicencaCash({
      sistema: ctx.sistema,
      contaId: ctx.conta.id,
      contaNome: ctx.conta.nome,
      contaEmail: ctx.conta.email,
      dataFim: ctx.dataFim,
      valor: ctx.valor,
      observacao: "Actualização via WhatsApp",
    });

    await setSession(client.id, "menu", {});

    return send(textoTalao(recibo));
  } catch (err) {
    console.error("[CASH] falha ao aplicar:", err.message);
    await setSession(client.id, "menu", {});
    return send(`❌ Não consegui actualizar a licença: ${err.message}`);
  }
}

function textoTalao(r) {
  const sistema = SISTEMAS_LICENCA_CASH[r.sistema] || r.sistema;
  const emitido = r.criado_em
    ? new Date(r.criado_em).toLocaleString("pt-MZ")
    : "—";

  return (
    "✅ *Licença actualizada*\n\n" +
    "🧾 *Talão de Conferência — pagamento em cash*\n" +
    `Referência: ${r.referencia}\n` +
    `Sistema: ${sistema}\n` +
    `Cliente: ${r.conta_nome}\n` +
    (r.conta_email ? `Email: ${r.conta_email}\n` : "") +
    `Data-fim anterior: ${r.data_fim_anterior || "sem data"}\n` +
    `Nova data-fim: *${r.data_fim_nova}*\n` +
    (r.valor !== null && r.valor !== undefined
      ? `Valor pago: ${formatMoney(r.valor)}\n`
      : "") +
    `Emitido em: ${emitido}\n\n` +
    "_Documento de conferência interna. Não constitui factura fiscal._\n\n" +
    'Escreva "menu" para voltar ao menu.'
  );
}

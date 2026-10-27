import { setSession } from "../services/sessionService.js";

/**
 * Fluxo VUKA: Venda de Jornais e Revistas Digitais de Moçambique por WhatsApp.
 *
 * Ativado ao escrever "vuka" no WhatsApp.
 * Enquanto o estado começar por "vuka_", o bot trata exclusivamente do catálogo VUKA.
 * "sair" devolve ao menu geral.
 * Cobrança via PaySuite e leitura no VUKA Reader.
 */

const VUKA_API_URL = (process.env.VUKA_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");
const VUKA_READER_URL = (process.env.VUKA_READER_URL || "http://localhost:5173").replace(/\/$/, "");

const formatMZN = (cents) => `${(Number(cents || 0) / 100).toFixed(2)} MZN`;

const telefoneLocal = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  return d.startsWith("258") && d.length === 12 ? d.slice(3) : d;
};

export const isVukaTrigger = (text) => {
  const t = String(text || "").trim().toLowerCase();
  return t === "vuka" || t === "jornal" || t === "jornais" || t === "noticias" || t === "revista";
};

export const isVukaState = (estado) => String(estado || "").startsWith("vuka_");
const SAIR = ["sair", "exit", "cancelar", "0", "menu"];

async function fetchCatalogoVuka() {
  const res = await fetch(`${VUKA_API_URL}/catalog`);
  if (!res.ok) throw new Error(`catalog error ${res.status}`);
  const data = await res.json();
  return data.catalog || [];
}

export async function startVuka(client, send) {
  let publicacoes;
  try {
    publicacoes = await fetchCatalogoVuka();
  } catch (err) {
    console.error("[VUKA] Erro ao carregar catálogo:", err.message);
    await setSession(client.id, "menu", {});
    return send("📰 Não consegui carregar as edições do VUKA no momento. Por favor tente mais tarde.");
  }

  if (!publicacoes.length) {
    await setSession(client.id, "menu", {});
    return send("📰 De momento não há edições disponíveis para venda no VUKA.");
  }

  const listaOfertas = [];
  publicacoes.forEach((pub) => {
    (pub.offers || []).forEach((offer) => {
      listaOfertas.push({
        offerId: offer.id,
        pubTitle: pub.title,
        publisher: pub.publisherName,
        title: offer.title,
        priceMinorUnits: offer.priceMinorUnits,
        currency: offer.currency || "MZN"
      });
    });
  });

  if (!listaOfertas.length) {
    await setSession(client.id, "menu", {});
    return send("📰 Nenhuma oferta ativa encontrada no VUKA. Tente mais tarde.");
  }

  await setSession(client.id, "vuka_menu", { ofertas: listaOfertas });

  const linhas = listaOfertas.map(
    (o, n) => `*${n + 1}.* 📰 *${o.pubTitle}* (${o.title})\n   Editora: _${o.publisher}_\n   Preço: *${formatMZN(o.priceMinorUnits)}*`
  );

  return send(
    `🇲🇿 *VUKA — Banca Digital de Moçambique*\n\n` +
      `Escolha o jornal ou revista que deseja ler hoje:\n\n` +
      `${linhas.join("\n\n")}\n\n` +
      `👉 *Responda com o NÚMERO da edição desejada.*\n` +
      `Escreva *sair* para voltar ao menu geral.`
  );
}

export async function handleVukaState(estado, client, ctx, text, send) {
  const lower = String(text || "").trim().toLowerCase();

  if (SAIR.includes(lower)) {
    await setSession(client.id, "menu", {});
    return send("👋 Saiu do VUKA. Escreva *menu* para ver as opções gerais.");
  }

  if (lower === "vuka" || lower === "banca" || lower === "jornais") {
    return startVuka(client, send);
  }

  switch (estado) {
    case "vuka_menu":
      return escolherEdicao(client, ctx, lower, send);
    case "vuka_metodo":
      return escolherMetodo(client, ctx, lower, send);
    case "vuka_aguardar":
      return verificarPagamentoVuka(client, ctx, send);
    default:
      return startVuka(client, send);
  }
}

async function escolherEdicao(client, ctx, lower, send) {
  const ofertas = ctx.ofertas || [];
  const n = parseInt(lower, 10);
  const oferta = Number.isInteger(n) ? ofertas[n - 1] : null;

  if (!oferta) {
    return send(`⚠️ Por favor escolha um número válido entre 1 e ${ofertas.length}, ou escreva *sair*.`);
  }

  await setSession(client.id, "vuka_metodo", { oferta });

  return send(
    `✅ Escolheu: *${oferta.pubTitle}* (${oferta.title})\n` +
      `💰 Valor: *${formatMZN(oferta.priceMinorUnits)}*\n\n` +
      `Como deseja pagar?\n` +
      `*1.* 🔴 M-Pesa (Vodacom)\n` +
      `*2.* 🟡 e-Mola (Movitel)\n\n` +
      `Responda com *1* ou *2*:`
  );
}

async function escolherMetodo(client, ctx, lower, send) {
  const oferta = ctx.oferta;
  if (!oferta) return startVuka(client, send);

  let method = "mpesa";
  if (lower === "2" || lower.includes("emola") || lower.includes("e-mola")) {
    method = "emola";
  } else if (lower !== "1" && !lower.includes("mpesa") && !lower.includes("m-pesa")) {
    return send("Por favor responda com *1* para M-Pesa ou *2* para e-Mola (ou *sair*):");
  }

  const phone = telefoneLocal(client.whatsapp_number);

  let order;
  try {
    const orderRes = await fetch(`${VUKA_API_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId: oferta.offerId,
        buyerContact: phone,
        buyerName: client.name || "Leitor WhatsApp",
        channel: "whatsapp"
      })
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.order) {
      throw new Error(orderData.error?.message || "Falha ao criar pedido no VUKA");
    }
    order = orderData.order;
  } catch (err) {
    console.error("[VUKA] Erro ao criar pedido:", err.message);
    return send(`❌ Não foi possível gerar o pedido: ${err.message}. Tente novamente.`);
  }

  let payResult;
  try {
    const payRes = await fetch(`${VUKA_API_URL}/payments/paysuite/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        method,
        phoneNumber: phone,
        returnUrl: `${VUKA_READER_URL}/library`
      })
    });
    payResult = await payRes.json();
    if (!payRes.ok) {
      throw new Error(payResult.error?.message || "Erro PaySuite");
    }
  } catch (err) {
    console.error("[VUKA] Erro PaySuite:", err.message);
    return send(`❌ Erro ao iniciar cobrança no PaySuite: ${err.message}`);
  }

  await setSession(client.id, "vuka_aguardar", {
    oferta,
    orderId: order.id,
    orderRef: order.publicReference,
    checkoutUrl: payResult.payment?.checkoutUrl
  });

  const methodName = method === "mpesa" ? "M-Pesa" : "e-Mola";
  let msg = `📲 *Pagamento VUKA — ${oferta.pubTitle}*\n\n` +
    `Referência: *${order.publicReference}*\n` +
    `Valor: *${formatMZN(oferta.priceMinorUnits)}*\n` +
    `Método: *${methodName}*\n\n` +
    `⚡ Foi enviado um pedido de pagamento para o seu telemóvel. Por favor digite o seu PIN para confirmar.\n`;

  if (payResult.payment?.checkoutUrl) {
    msg += `\nOu se preferir, pague por este link:\n${payResult.payment.checkoutUrl}\n`;
  }

  msg += `\nApós digitar o PIN, responda com *paguei* para receber o link do jornal! 📖`;

  return send(msg);
}

async function verificarPagamentoVuka(client, ctx, send) {
  if (!ctx.orderRef) return startVuka(client, send);

  let data;
  try {
    const res = await fetch(`${VUKA_API_URL}/orders/ref/${encodeURIComponent(ctx.orderRef)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Erro ${res.status}`);
  } catch (err) {
    console.error("[VUKA] Erro ao verificar pedido:", err.message);
    return send("⏳ Ainda não foi possível confirmar. Se já digitou o PIN, aguarde uns segundos e escreva *paguei* novamente.");
  }

  const order = data.order;
  if (order && order.status === "PAID") {
    await setSession(client.id, "vuka_menu", {});

    const readerLink = `${VUKA_READER_URL}/reader/${order.offer?.editionId || ""}?ref=${order.publicReference}`;

    return send(
      `🎉 *Pagamento Confirmado!*\n\n` +
        `Obrigado pela compra da edição de *${ctx.oferta?.pubTitle || "VUKA"}*.\n\n` +
        `📖 *Aceda ao seu jornal aqui:*\n${readerLink}\n\n` +
        `Seu acesso é seguro e já está liberado na sua biblioteca.\n` +
        `Escreva *vuka* para comprar outro jornal ou *menu* para sair.`
    );
  }

  return send(
    `⏳ O pagamento da referência *${ctx.orderRef}* ainda está pendente.\n` +
      `Por favor confirme o PIN no telemóvel e escreva *paguei*.`
  );
}

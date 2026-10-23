import { setSession } from "../services/sessionService.js";

/**
 * Fluxo DoReMi: venda de músicas e beats por WhatsApp.
 *
 * Entra-se escrevendo "doremi"; enquanto o estado começar por "doremi_" o bot
 * só trata de assuntos do DoReMi. "sair" devolve ao menu normal.
 * O pagamento usa a mesma API da página /comprar/[id] (PaySuite) e a entrega
 * é o link /download?code=... quando a compra fica PAID.
 */

const DOREMI_URL = (process.env.DOREMI_URL || "https://doremi.tecnoincubadora.org").replace(/\/$/, "");

const formatMZN = (cents) => `${(Number(cents || 0) / 100).toFixed(2)} MZN`;

// A PaySuite espera o número local (9 dígitos); a Meta envia com 258.
const telefoneLocal = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  return d.startsWith("258") && d.length === 12 ? d.slice(3) : d;
};

export const isDoremiTrigger = (text) => String(text || "").trim().toLowerCase() === "doremi";
export const isDoremiState = (estado) => String(estado || "").startsWith("doremi_");
const SAIR = ["sair", "exit", "cancelar"];

async function fetchCatalogo() {
  const res = await fetch(`${DOREMI_URL}/api/public/catalog`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  return [
    ...(data.musicas || []).map((m) => ({ ...m, tipo: "musica" })),
    ...(data.beats || []).map((b) => ({ ...b, tipo: "beat" })),
    ...(data.albuns || []).map((a) => ({ ...a, tipo: "album" })),
  ];
}

export async function startDoremi(client, send) {
  let itens;
  try {
    itens = await fetchCatalogo();
  } catch (err) {
    console.error("[DOREMI] catálogo:", err.message);
    await setSession(client.id, "menu", {});
    return send("😕 Não consegui carregar o catálogo DoReMi agora. Tenta mais tarde.");
  }

  // Guarda só o necessário para a escolha por número.
  const lista = itens.map(({ id, tipo, titulo, autor, precoCents }) => ({ id, tipo, titulo, autor, precoCents }));
  await setSession(client.id, "doremi_menu", { itens: lista });

  const linhas = lista.map(
    (i, n) => `*${n + 1}.* ${i.tipo === "beat" ? "🎧" : i.tipo === "album" ? "💿" : "🎵"} ${i.titulo} — ${i.autor} · ${formatMZN(i.precoCents)}`
  );

  const mensagemItens = itens.length
    ? `🎶 *DoReMi — à venda*\n\n${linhas.join("\n")}\n\n`
    : "🎵 De momento não há músicas nem beats à venda no DoReMi.\n\n";

  return send(
    `${mensagemItens}` +
      `Responde com o *número* do que queres comprar.\n` +
      `Escreve *bilhetes* para ver opções de bilhetes digitais.\n` +
      `Escreve *convites* para ver opções de convites digitais.\n` +
      `Escreve *sair* para voltar ao menu.`
  );
}

export async function handleDoremiState(estado, client, ctx, text, send) {
  const lower = String(text || "").trim().toLowerCase();

  if (SAIR.includes(lower)) {
    await setSession(client.id, "menu", {});
    return send("👋 Saíste do DoReMi. Escreve *menu* para ver as outras opções.");
  }
  if (lower === "doremi" || lower === "lista") return startDoremi(client, send);

  if (lower === "bilhetes") {
    await setSession(client.id, "menu", {});
    return send(
      "🎫 *Bilhetes digitais*\n\n" +
        "Consulta os eventos disponíveis em https://doremi.tecnoincubadora.org/events\n\n" +
        "Ou queres organizar o teu próprio evento? Contacta https://wa.me/258861390985"
    );
  }

  if (lower === "convites") {
    await setSession(client.id, "menu", {});
    return send(
      "💌 *Convites digitais*\n\n" +
        "Compra modelos de convite em https://convites-beta.vercel.app\n\n" +
        "Ou cria o teu próprio convite para o teu evento."
    );
  }

  switch (estado) {
    case "doremi_menu":
      return escolherItem(client, ctx, lower, send);
    case "doremi_nome":
      return criarCompra(client, ctx, text, send);
    case "doremi_aguardar":
      return verificarPagamento(client, ctx, send);
    default:
      return startDoremi(client, send);
  }
}

async function escolherItem(client, ctx, lower, send) {
  const itens = ctx.itens || [];
  const n = parseInt(lower, 10);
  const item = Number.isInteger(n) ? itens[n - 1] : null;
  if (!item) {
    return send(`Escolhe um número entre 1 e ${itens.length}, ou escreve *sair*.`);
  }

  await setSession(client.id, "doremi_nome", { item });
  const nome = client.nome ? ` (ou *ok* para usar "${client.nome}")` : "";
  return send(
    `Escolheste: *${item.titulo}* — ${formatMZN(item.precoCents)}\n\n` +
      `Qual é o teu nome para a compra?${nome}`
  );
}

async function criarCompra(client, ctx, text, send) {
  const item = ctx.item;
  if (!item) return startDoremi(client, send);

  let nome = String(text || "").trim();
  if (nome.toLowerCase() === "ok" && client.nome) nome = client.nome;
  if (nome.length < 2) return send("Escreve o teu nome (mínimo 2 letras).");
const body = {
    buyerName: nome.slice(0, 100),
    buyerPhone: telefoneLocal(client.whatsapp_number),
    ...(item.tipo === "beat"
      ? { beatId: item.id }
      : item.tipo === "album"
        ? { albumId: item.id }
        : { postId: item.id }),
  };
  let data;
  try {
    const res = await fetch(`${DOREMI_URL}/api/public/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok || !data.checkoutUrl) {
      throw new Error(data.error || data.message || `buy ${res.status}`);
    }
  } catch (err) {
    console.error("[DOREMI] compra:", err.message);
    await setSession(client.id, "doremi_menu", { itens: ctx.itens || [] });
    return send(`😕 Não foi possível iniciar a compra: ${err.message}\nEscreve *lista* para ver o catálogo.`);
  }

  await setSession(client.id, "doremi_aguardar", { item, purchaseId: data.purchaseId });
  return send(
    `💳 *Pagamento — ${item.titulo}* (${formatMZN(item.precoCents)})\n\n` +
      `Paga aqui (M-Pesa, e-Mola ou cartão):\n${data.checkoutUrl}\n\n` +
      `Depois de pagar, escreve *paguei* e eu envio-te o link de download. 🎧`
  );
}

async function verificarPagamento(client, ctx, send) {
  if (!ctx.purchaseId) return startDoremi(client, send);

  let data;
  try {
    const res = await fetch(`${DOREMI_URL}/api/public/purchase-status?id=${encodeURIComponent(ctx.purchaseId)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || `status ${res.status}`);
  } catch (err) {
    console.error("[DOREMI] status:", err.message);
    return send("😕 Não consegui verificar o pagamento agora. Tenta escrever *paguei* daqui a pouco.");
  }

  if (data.status === "PAID" && data.downloadCode) {
    await setSession(client.id, "doremi_menu", {});
    return send(
      `✅ Pagamento confirmado! Obrigado, ${data.buyerName || ""}.\n\n` +
        `⬇️ *${data.title}*\n${DOREMI_URL}/download?code=${data.downloadCode}\n\n` +
        `Código: *${data.downloadCode}* (válido 30 dias, até 5 downloads).\n\n` +
        `Escreve *lista* para comprar mais ou *sair* para terminar.`
    );
  }

  if (data.status === "EXPIRED" || data.status === "CANCELLED") {
    await setSession(client.id, "doremi_menu", {});
    return send("❌ Esta compra expirou ou foi cancelada. Escreve *lista* para tentar de novo.");
  }

  return send("⏳ Ainda não recebi a confirmação do pagamento. Conclui o pagamento no link e escreve *paguei* outra vez.");
}

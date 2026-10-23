import { setSession } from "../services/sessionService.js";

/**
 * Fluxo DoReMi: venda exclusiva de Álbuns por WhatsApp.
 *
 * Músicas e beats individuais foram removidos da venda a pedido do administrador.
 * Entra-se escrevendo "doremi"; enquanto o estado começar por "doremi_" o bot
 * só trata de assuntos do DoReMi. "sair" devolve ao menu normal.
 * O pagamento usa o checkout PaySuite e a entrega é o link direto do álbum
 * /baixar-albuns/d/<token> quando o pagamento fica PAID.
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
  return data.albuns || [];
}

export async function startDoremi(client, send) {
  let itens;
  try {
    itens = await fetchCatalogo();
  } catch (err) {
    console.error("[DOREMI] catálogo de álbuns:", err.message);
    await setSession(client.id, "menu", {});
    return send("😕 Não consegui carregar o catálogo de álbuns DoReMi agora. Tenta mais tarde.");
  }

  if (!itens.length) {
    await setSession(client.id, "menu", {});
    return send("💿 De momento não há álbuns disponíveis para venda no DoReMi.");
  }

  // Guarda só o necessário para a escolha por número.
  const lista = itens.map(({ id, titulo, autor, precoCents, trackCount, genre }) => ({
    id,
    tipo: "album",
    titulo,
    autor,
    precoCents,
    trackCount,
    genre
  }));
  await setSession(client.id, "doremi_menu", { itens: lista });

  const linhas = lista.map(
    (i, n) => `*${n + 1}.* 💿 *${i.titulo}* — ${i.autor} · ${formatMZN(i.precoCents)}${i.trackCount ? ` (${i.trackCount} faixas)` : ""}`
  );
  return send(
    `💿 *DoReMi — Álbuns à venda*\n\n${linhas.join("\n")}\n\n` +
      `Responde com o *número* do álbum que queres comprar.\nEscreve *sair* para voltar ao menu.`
  );
}

export async function handleDoremiState(estado, client, ctx, text, send) {
  const lower = String(text || "").trim().toLowerCase();

  if (SAIR.includes(lower)) {
    await setSession(client.id, "menu", {});
    return send("👋 Saíste do DoReMi. Escreve *menu* para ver as outras opções.");
  }
  if (lower === "doremi" || lower === "lista" || lower === "albuns" || lower === "álbuns") return startDoremi(client, send);

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
  return send(
    `Escolheste: *${item.titulo}* — ${formatMZN(item.precoCents)}\n\n` +
      `Por favor, escreve o teu *Nome Completo* para a compra:`
  );
}

async function criarCompra(client, ctx, text, send) {
  const item = ctx.item;
  if (!item) return startDoremi(client, send);

  const nome = String(text || "").trim();
  if (nome.length < 2 || nome.toLowerCase() === "ok") {
    return send("É obrigatório escrever o teu nome completo (mínimo 2 letras) para prosseguir:");
  }

  const body = {
    buyerName: nome.slice(0, 100),
    buyerPhone: telefoneLocal(client.whatsapp_number),
    albumId: item.id
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
    console.error("[DOREMI] compra de álbum:", err.message);
    await setSession(client.id, "doremi_menu", { itens: ctx.itens || [] });
    return send(`😕 Não foi possível iniciar a compra: ${err.message}\nEscreve *lista* para ver os álbuns.`);
  }

  await setSession(client.id, "doremi_aguardar", { item, purchaseId: data.purchaseId || data.saleId });
  return send(
    `💳 *Pagamento — Álbum "${item.titulo}"* (${formatMZN(item.precoCents)})\n\n` +
      `Paga aqui (M-Pesa, e-Mola ou cartão):\n${data.checkoutUrl}\n\n` +
      `Depois de pagar, escreve *paguei* e eu envio-te o link de download do álbum completo. 💿`
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
    const downloadUrl = data.downloadUrl || `${DOREMI_URL}/baixar-albuns/d/${data.downloadCode}`;
    return send(
      `✅ Pagamento confirmado! Obrigado, ${data.buyerName || ""}.\n\n` +
        `💿 *${data.title}*\n${downloadUrl}\n\n` +
        `Link de download: *${data.downloadCode}* (permite até 3 downloads).\n\n` +
        `Escreve *lista* para ver outros álbuns ou *sair* para terminar.`
    );
  }

  if (data.status === "EXPIRED" || data.status === "CANCELLED") {
    await setSession(client.id, "doremi_menu", {});
    return send("❌ Esta compra expirou ou foi cancelada. Escreve *lista* para tentar de novo.");
  }

  return send("⏳ Ainda não recebi a confirmação do pagamento. Conclui o pagamento no link e escreve *paguei* outra vez.");
}

import { sendTextMessage } from "./metaApi.js";
import { getClientByWhatsapp, touchClient, setClientName } from "./dbService.js";
import { getSession, setSession } from "./sessionService.js";
import { MENU, sendMenu } from "../flows/menu.js";
import {
  startCotacao,
  startEncomenda,
  handleCotacaoTipo,
  handleCotacaoProdutoLista,
  handleCotacaoDescricao,
} from "../flows/cotacao.js";
import { showProdutos, handlePlanoEscolha } from "../flows/planos.js";
import { showPagamento, handlePlanoContratar, handlePagamentoMetodo } from "../flows/pagamento.js";
import { falarComHumano } from "../flows/humano.js";

const COMANDOS_MENU = ["menu", "iniciar", "começar", "comecar", "ola", "olá", "oi", "hey", "0"];

/**
 * Ponto de entrada para cada mensagem de texto recebida no webhook.
 * Gere o cliente + sessão e encaminha para o fluxo consoante o estado.
 */
export async function handleIncomingMessage(message, changeValue, tenant) {
  const phone = message.from;
  const text = ((message.text && message.text.body) || "").trim();
  const senderName =
    (changeValue &&
      changeValue.contacts &&
      changeValue.contacts[0] &&
      changeValue.contacts[0].profile &&
      changeValue.contacts[0].profile.name) ||
    "";

  console.log(`[MSG][tenant ${tenant ? tenant.id : "?"}] ${senderName || "cliente"} (${phone}): "${text}"`);

  const send = (reply) => sendTextMessage(phone, reply, tenant);
  const lower = text.toLowerCase();

  const client = await getClientByWhatsapp(tenant.id, phone);
  await touchClient(client.id);
  await setClientName(client.id, senderName);

  const session = await getSession(tenant.id, client.id);
  const estado = session.estado_atual || "inicio";
  const ctx = session.contexto || {};

  // Comandos globais: voltar ao menu / cancelar
  if (COMANDOS_MENU.includes(lower)) {
    await setSession(client.id, "menu", {});
    return sendMenu(send, senderName);
  }

  switch (estado) {
    case "cotacao_tipo":
      return handleCotacaoTipo(client, ctx, text, send);
    case "cotacao_produto_lista":
      return handleCotacaoProdutoLista(client, ctx, text, send);
    case "cotacao_descricao":
      return handleCotacaoDescricao(client, ctx, text, send);
    case "planos_lista":
      return handlePlanoEscolha(client, ctx, text, send);
    case "planos_plano":
      return handlePlanoContratar(client, ctx, text, send);
    case "pagamento_metodo":
      return handlePagamentoMetodo(client, ctx, text, send);
    case "humano":
      return send(
        "Já registámos o seu pedido de atendimento humano. Aguarde, por favor. " +
          'Escreva "menu" para voltar às opções.'
      );
    case "menu":
    default:
      return routeMenu(client, lower, send);
  }
}

function routeMenu(client, lower, send) {
  if (lower === "1" || lower.includes("cotação") || lower.includes("cotacao")) {
    return startCotacao(client, send);
  }
  if (lower === "2" || lower.includes("plano") || lower.includes("preço") || lower.includes("preco")) {
    return showProdutos(client, send);
  }
  if (lower === "3" || lower.includes("pagar") || lower.includes("licen")) {
    return showPagamento(client, send);
  }
  if (lower === "4" || lower.includes("encomend") || lower.includes("sistema")) {
    return startEncomenda(client, send);
  }
  if (lower === "5" || lower.includes("humano") || lower.includes("atendente")) {
    return falarComHumano(client, send);
  }
  return send(`Não entendi o seu pedido. 🤔\n\nEscolha uma opção:\n${MENU}`);
}

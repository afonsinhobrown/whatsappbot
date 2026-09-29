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
import {
  showPagamento,
  handlePlanoContratar,
  handlePagamentoMetodo,
  handlePagamentoSaasUser,
  handlePagamentoSaasSenha,
  handlePagamentoHefelgymId
} from "../flows/pagamento.js";
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

  // Se a mensagem vier do administrador e for um comando de resposta (!responder numero mensagem)
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER || "";
  if (phone === adminPhone && text.toLowerCase().startsWith("!responder")) {
    const parts = text.split(" ");
    if (parts.length >= 3) {
      const targetPhone = parts[1];
      const replyText = parts.slice(2).join(" ");
      await sendTextMessage(targetPhone, `👨‍💻 *Atendimento:* ${replyText}`, tenant);
      return sendTextMessage(phone, `✅ Mensagem enviada para ${targetPhone}.`, tenant);
    } else {
      return sendTextMessage(phone, `❌ Erro no comando. Use: !responder NUMERO MENSAGEM`, tenant);
    }
  }

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
      return handleCotacaoDescricao(client, ctx, text, send, tenant);
    case "planos_lista":
      return handlePlanoEscolha(client, ctx, text, send);
    case "planos_plano":
      return handlePlanoContratar(client, ctx, text, send);
    case "pagamento_saas_user":
      return handlePagamentoSaasUser(client, ctx, text, send);
    case "pagamento_saas_senha":
      return handlePagamentoSaasSenha(client, ctx, text, send);
    case "pagamento_hefelgym_id":
      return handlePagamentoHefelgymId(client, ctx, text, send);
    case "pagamento_metodo":
      return handlePagamentoMetodo(client, ctx, text, send);
    case "humano":
      // Encaminhar a resposta do cliente para o admin em modo relay
      if (adminPhone) {
        await sendTextMessage(adminPhone, `📩 *Mensagem de ${client.nome || "Cliente"} (${client.whatsapp_number}):*\n${text}\n\n_Responda usando: !responder ${client.whatsapp_number} sua mensagem_`, tenant);
      }
      return; // não envia feedback automático ao cliente
    case "menu":
    default:
      return routeMenu(client, lower, send, tenant);
  }
}

function routeMenu(client, lower, send, tenant) {
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
    return falarComHumano(client, send, tenant);
  }
  return send(`Não entendi o seu pedido. 🤔\n\nEscolha uma opção:\n${MENU}`);
}

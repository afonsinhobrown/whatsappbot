import { sendTextMessage } from "./metaApi.js";
import { isAiEnabled } from "./aiService.js";
import { handleAiMessage } from "../flows/aiChat.js";
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
  handlePagamentoEscolherProduto,
  handlePagamentoDadosConta,
  handlePagamentoEscolherOpcao,
  handlePagamentoEscolherPlano,
  handlePlanoContratar,
  handlePagamentoMetodo,
} from "../flows/pagamento.js";
import { falarComHumano } from "../flows/humano.js";
import { startSDR, handleSDR } from "../flows/sdr.js";
import {
  isSaudacao,
  responderSaudacao,
  responderSaudacaoEmFluxo,
} from "../flows/saudacao.js";
import { sendDashboardReport } from "../flows/dashboard.js";
import { adminNumbers } from "../config/env.js";

const COMANDOS_MENU = ["menu", "iniciar", "começar", "comecar", "ola", "olá", "oi", "hey", "0"];

const somenteDigitos = (v) => String(v || "").replace(/\D/g, "");

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
  // A comparação é feita só com dígitos: o número chega da Meta como "2588..." e
  // a variável de ambiente pode estar guardada com +, espaços ou o país, e a
  // comparação literal nunca batia.
  //
  // Este teste fica dentro de um try/catch: corria antes de qualquer protecção,
  // e uma falha aqui impedia o bot de responder a QUALQUER cliente.
  let numerosAdmin = [];
  try {
    numerosAdmin = adminNumbers();
  } catch (err) {
    console.error("[ADMIN] não consegui ler os números de admin:", err.message);
  }
  if (numerosAdmin.includes(somenteDigitos(phone))) {
    if (text.toLowerCase() === "!dashboard") {
      const sendFn = (reply) => sendTextMessage(phone, reply, tenant);
      return sendDashboardReport(sendFn, tenant);
    }
    
    if (text.toLowerCase().startsWith("!responder")) {
      const parts = text.split(" ");
    if (parts.length >= 3) {
      const targetPhone = parts[1];
      const replyText = parts.slice(2).join(" ");
      await sendTextMessage(targetPhone, `👨‍💻 *Administrador:* ${replyText}`, tenant);
      
      try {
        const targetClient = await getClientByWhatsapp(tenant.id, targetPhone);
        if (targetClient) {
          await setSession(targetClient.id, "humano", { desde: new Date().toISOString() });
        }
      } catch (err) {
        console.error("Erro ao actualizar estado do cliente para humano:", err);
      }

      return sendTextMessage(phone, `✅ Mensagem enviada para ${targetPhone}.`, tenant);
    } else {
      return sendTextMessage(phone, `❌ Erro no comando. Use: !responder NUMERO MENSAGEM`, tenant);
    }
  }

  // O dono também é cliente do bot, por isso escreve "bom dia" de vez em
  // quando para testar. Sem isto, o bot tratava o próprio dono como cliente e
  //-lhe mandava a saudação e o menu — ele já sabe quem é, a mensagem só
  // barrava o ecrã. Silêncio é o que se pede aqui.
  if (numerosAdmin.includes(somenteDigitos(phone)) && isSaudacao(text)) {
    console.log(`[MSG] saudação do próprio dono (${phone}) — sem resposta`);
    return;
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

  // Saudação a meio de um fluxo ("bom dia", "tudo bem"). Fica depois dos
  // comandos globais para não mudar o que já acontecia com "oi"/"ola" exatos,
  // e não toca no estado: o cliente ia a meio de uma cotação e deitá-la fora  // para lhe cumprimentar era pior do que a resposta trocada.
  //
  // O estado "humano" fica de fora de propósito: lá a mensagem do cliente é
  // para o administrador, e responder "olá" por cima era tirar-lhe a
  // atendimento que ele próprio tinha pedido.
  if (
    estado !== "inicio" &&
    estado !== "menu" &&
    estado !== "humano" &&
    isSaudacao(text)
  ) {
    return responderSaudacaoEmFluxo(client, send);
  }

  switch (estado) {
    case "sdr_qualificacao":
      return handleSDR(client, ctx, text, send, tenant);
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
    case "pagamento_escolher_produto":
      return handlePagamentoEscolherProduto(client, ctx, text, send);
    case "pagamento_dados_conta":
      return handlePagamentoDadosConta(client, ctx, text, send);
    case "pagamento_escolher_opcao":
      return handlePagamentoEscolherOpcao(client, ctx, text, send);
    case "pagamento_escolher_plano":
      return handlePagamentoEscolherPlano(client, ctx, text, send);
    case "pagamento_metodo":
      return handlePagamentoMetodo(client, ctx, text, send);
    case "humano":
      // Um cliente que pede falar com administrador mas depois escreve "menu"
      // (ou qualquer comando global) já é tratado acima e sai do estado.
      // Sem isto, o bot ficava a responder "mensagem enviada ao admin"
      // para sempre, sem o cliente conseguir voltar ao menu.
      //
      // Uma saudação não é pedido de nada: um "bom dia" deixado no ar
      // acordava o dono de madrugada sem haver nada para responder. O cliente
      // continua no estado humano e a conversa real chega ao admin logo a
      // seguir.
      if (isSaudacao(text)) {
        console.log(`[MSG] saudação ignorada de ${client.whatsapp_number} (estado humano)`);
        return;
      }
      //
      // O encaminhamento ao admin não pode derrubar a mensagem do cliente: um
      // número inválido ou um token expirado fariam a excepção sair daqui e a
      // mensagem nunca chegava a lado nenhum.
      for (const numero of numerosAdmin) {
        try {
          await sendTextMessage(numero, `📩 *Mensagem de ${client.nome || "Cliente"} (${client.whatsapp_number}):*\n${text}\n\n_Responda usando: !responder ${client.whatsapp_number} sua mensagem_`, tenant);
        } catch (err) {
          console.error(`[ADMIN] não consegui entregar a mensagem em ${numero}: ${err.message}`);
        }
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
  if (
    lower === "5" ||
    lower.includes("administrador") ||
    lower.includes("admin") ||
    lower.includes("humano") ||
    lower.includes("atendente")
  ) {
    return falarComHumano(client, send, tenant);
  }
  if (lower === "6" || lower.includes("demonstração") || lower.includes("demonstracao") || lower.includes("agendar") || lower.includes("qualificacao")) {
    return startSDR(client, send, tenant);
  }
  // "bom dia", "tudo bem", "e aí": o cliente está a dizer olá, não a
  // escolher uma opção. Sem isto, respondia "Não entendi o seu pedido" a uma
  // saudação — e era isso que o fez parecer um bot mudo.
  if (isSaudacao(lower)) {
    return responderSaudacao(client, send);
  }
  // Fallback inteligente: se a IA estiver activa, responde com GPT em vez
  // de "Não entendi". Se não estiver configurada, comportamento anterior.
  if (isAiEnabled()) {
    return handleAiMessage(client, lower, send, tenant);
  }
  return send(`Não entendi o seu pedido. 🤔\n\nEscolha uma opção:\n${MENU}`);
}

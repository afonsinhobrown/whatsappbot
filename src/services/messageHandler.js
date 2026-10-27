import { sendTextMessage, downloadMedia } from "./metaApi.js";
import { isAiEnabled, analyzeMedia } from "./aiService.js";
import { handleAiMessage } from "../flows/aiChat.js";
import { getClientByWhatsapp, touchClient, setClientName } from "./dbService.js";
import { getSession, setSession } from "./sessionService.js";
import { MENU, sendMenu, sendAdminHelp } from "../flows/menu.js";
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
import {
  startLicencaCash,
  handleCashSistema,
  handleCashNome,
  handleCashConta,
  handleCashData,
  handleCashValor,
  handleCashConfirmar,
} from "../flows/licencaCash.js";
import {
  isNhamaingaNumber,
  startNhamaingaMenu,
  handleNhamaingaState,
} from "../flows/nhamainga.js";
import {
  isDoremiTrigger,
  isDoremiState,
  startDoremi,
  handleDoremiState,
} from "../flows/doremi.js";
import { adminNumbers } from "../config/env.js";

const COMANDOS_MENU = ["menu", "iniciar", "comeÃ§ar", "comecar", "ola", "olÃ¡", "oi", "hey", "0"];

const somenteDigitos = (v) => String(v || "").replace(/\D/g, "");

/**
 * Ponto de entrada para cada mensagem de texto recebida no webhook.
 * Gere o cliente + sessÃ£o e encaminha para o fluxo consoante o estado.
 */
export async function handleIncomingMessage(message, changeValue, tenant) {
  const phone = message.from;
  let text = ((message.text && message.text.body) || "").trim();
  const senderName =
    (changeValue &&
      changeValue.contacts &&
      changeValue.contacts[0] &&
      changeValue.contacts[0].profile &&
      changeValue.contacts[0].profile.name) ||
    "";

  console.log(`[MSG][tenant ${tenant ? tenant.id : "?"}] ${senderName || "cliente"} (${phone}): "${text || "[" + message.type + "]"}"`);

  const send = (reply) => sendTextMessage(phone, reply, tenant);

  // Fase 5 e 6: Ãudio e Imagens
  if (message.type === "audio" && message.audio) {
    if (!isAiEnabled()) return send("Desculpa, nÃ£o consigo ouvir Ã¡udios neste momento.");
    send("A ouvir o teu Ã¡udio... ðŸŽ§");
    try {
      const media = await downloadMedia(message.audio.id, tenant);
      const respostaIA = await analyzeMedia(media, "O utilizador enviou um Ã¡udio. Responde diretamente e amigavelmente ao que ele pede ou diz.", tenant);
      return send(respostaIA);
    } catch (e) {
      console.error("[VOZ] Falha ao processar:", e.message);
      return send("Desculpa, tive um problema a abrir o Ã¡udio. Podes escrever?");
    }
  }

  if (message.type === "image" && message.image) {
    if (!isAiEnabled()) return send("Desculpa, nÃ£o consigo ver imagens neste momento.");
    send("A analisar a tua imagem... ðŸ‘ï¸");
    try {
      const media = await downloadMedia(message.image.id, tenant);
      const respostaIA = await analyzeMedia(media, "O utilizador enviou esta imagem. Se for um comprovativo de pagamento, confirma e extrai os dados. SenÃ£o, descreve o que vÃªs ou responde adequadamente.", tenant);
      return send(respostaIA);
    } catch (e) {
      console.error("[IMAGEM] Falha ao processar:", e.message);
      return send("Desculpa, tive um problema a ler a imagem.");
    }
  }

  // Se a mensagem vier do administrador e for um comando de resposta (!responder numero mensagem)
  // A comparaÃ§Ã£o Ã© feita sÃ³ com dÃ­gitos: o nÃºmero chega da Meta como "2588..." e
  // a variÃ¡vel de ambiente pode estar guardada com +, espaÃ§os ou o paÃ­s, e a
  // comparaÃ§Ã£o literal nunca batia.
  //
  // Este teste fica dentro de um try/catch: corria antes de qualquer protecÃ§Ã£o,
  // e uma falha aqui impedia o bot de responder a QUALQUER cliente.
  let numerosAdmin = [];
  try {
    numerosAdmin = adminNumbers();
  } catch (err) {
    console.error("[ADMIN] nÃ£o consegui ler os nÃºmeros de admin:", err.message);
  }
  
  const isAdmin = numerosAdmin.includes(somenteDigitos(phone));

  if (isAdmin) {
    if (["nhamainga", "!nhamainga"].includes(text.toLowerCase())) {
      const adminClient = await getClientByWhatsapp(tenant.id, phone);
      await getSession(tenant.id, adminClient.id);
      await setSession(adminClient.id, "nhamainga_menu", {});
      return startNhamaingaMenu(send);
    }

    if (["!licenca", "!licencas", "!cash"].includes(text.toLowerCase())) {
      const adminClient = await getClientByWhatsapp(tenant.id, phone);
      // getSession cria a linha se ainda nÃ£o existir; setSession sozinho nÃ£o
      // actualiza nada quando o admin nunca falou com o bot.
      await getSession(tenant.id, adminClient.id);
      await setSession(adminClient.id, "cash_sistema", {});
      return startLicencaCash(send);
    }

    if (["!ajuda", "!help"].includes(text.toLowerCase())) {
      return sendAdminHelp(send);
    }

    if (text.toLowerCase() === "!dashboard") {
      const sendFn = (reply) => sendTextMessage(phone, reply, tenant);
      return sendDashboardReport(sendFn, tenant);
    }
    
    if (text.toLowerCase().startsWith("!responder")) {
      const parts = text.split(" ");
    if (parts.length >= 3) {
      const targetPhone = parts[1];
      const replyText = parts.slice(2).join(" ");
      await sendTextMessage(targetPhone, `ðŸ‘¨â€ðŸ’» *Administrador:* ${replyText}`, tenant);
      
      try {
        const targetClient = await getClientByWhatsapp(tenant.id, targetPhone);
        if (targetClient) {
          await setSession(targetClient.id, "humano", { desde: new Date().toISOString() });
        }
      } catch (err) {
        console.error("Erro ao actualizar estado do cliente para humano:", err);
      }

      return sendTextMessage(phone, `âœ… Mensagem enviada para ${targetPhone}.`, tenant);
    } else {
      return sendTextMessage(phone, `âŒ Erro no comando. Use: !responder NUMERO MENSAGEM`, tenant);
    }
  }
}

// const send foi movido para cima
  const lower = text.toLowerCase();

  const client = await getClientByWhatsapp(tenant.id, phone);
  await touchClient(client.id);
  await setClientName(client.id, senderName);

  const session = await getSession(tenant.id, client.id);
  const estado = session.estado_atual || "inicio";
  const ctx = session.contexto || {};

  // O dono tambÃ©m usa o bot para testar; uma saudaÃ§Ã£o solta no menu normal
  // nÃ£o precisa de resposta. Mas dentro do menu Nhamainga (ou no nÃºmero
  // dedicado) a saudaÃ§Ã£o Ã© parte da conversa e deve ser acolhida.
  if (
    isAdmin &&
    !isNhamaingaNumber(phone) &&
    isSaudacao(text) &&
    !estado.startsWith("nhamainga_")
  ) {
    console.log(`[MSG] saudaÃ§Ã£o do prÃ³prio dono (${phone}) â€” sem resposta`);
    return;
  }

  // O fluxo de licenÃ§as cash sÃ³ existe para o dono/admin. Se o nÃºmero sair da
  // lista de admins a meio, nÃ£o pode continuar a mexer em licenÃ§as.
  if (estado.startsWith("cash_") && !isAdmin) {
    await setSession(client.id, "menu", {});
    return send("Esse comando Ã© restrito ao administrador.");
  }

  // Menu especializado da farmÃ¡cia Nhamainga: o nÃºmero dedicado entra sempre
  // neste menu, independentemente do estado anterior da conversa.
  if (isNhamaingaNumber(phone)) {
    if (estado.startsWith("nhamainga_") && estado !== "nhamainga_menu") {
      return handleNhamaingaState(estado, client, ctx, text, send, tenant);
    }
    if (
      estado === "nhamainga_menu" &&
      lower !== "0" &&
      lower !== "menu" &&
      !isSaudacao(text)
    ) {
      return handleNhamaingaState(estado, client, ctx, text, send, tenant);
    }
    await setSession(client.id, "nhamainga_menu", {});
    return startNhamaingaMenu(send, client, text);
  }

  // O admin abre o mesmo menu com "nhamainga". "sair"/"menu"/"0" devolvem-no
  // ao menu normal do bot.
  if (estado.startsWith("nhamainga_")) {
    if (["menu", "0", "sair", "cancelar"].includes(lower)) {
      await setSession(client.id, "menu", {});
      return sendMenu(send, senderName, isAdmin);
    }
    return handleNhamaingaState(estado, client, ctx, text, send, tenant);
  }

  // Fluxo DoReMi: ativaÃ§Ã£o com "doremi", exclusivo atÃ© o cliente sair
  if (isVukaTrigger(text)) {
    return startVuka(client, send);
  }

  if (isVukaState(estado)) {
    return handleVukaState(estado, client, ctx, text, send);
  }

  if (isDoremiTrigger(text)) {
    return startDoremi(client, send);
  }

  if (isDoremiState(estado)) {
    return handleDoremiState(estado, client, ctx, text, send);
  }

  // Comandos globais: voltar ao menu / cancelar
  if (COMANDOS_MENU.includes(lower)) {
    await setSession(client.id, "menu", {});
    return sendMenu(send, senderName, isAdmin);
  }

  // SaudaÃ§Ã£o a meio de um fluxo ("bom dia", "tudo bem"). Fica depois dos
  // comandos globais para nÃ£o mudar o que jÃ¡ acontecia com "oi"/"ola" exatos,
  // e nÃ£o toca no estado: o cliente ia a meio de uma cotaÃ§Ã£o e deitÃ¡-la fora  // para lhe cumprimentar era pior do que a resposta trocada.
  //
  // O estado "humano" fica de fora de propÃ³sito: lÃ¡ a mensagem do cliente Ã©
  // para o administrador, e responder "olÃ¡" por cima era tirar-lhe a
  // atendimento que ele prÃ³prio tinha pedido.
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
    case "cash_sistema":
      return handleCashSistema(client, ctx, text, send);
    case "cash_nome":
      return handleCashNome(client, ctx, text, send);
    case "cash_conta":
      return handleCashConta(client, ctx, text, send);
    case "cash_data":
      return handleCashData(client, ctx, text, send);
    case "cash_valor":
      return handleCashValor(client, ctx, text, send);
    case "cash_confirmar":
      return handleCashConfirmar(client, ctx, text, send);
    case "humano":
      // Um cliente que pede falar com administrador mas depois escreve "menu"
      // (ou qualquer comando global) jÃ¡ Ã© tratado acima e sai do estado.
      // Sem isto, o bot ficava a responder "mensagem enviada ao admin"
      // para sempre, sem o cliente conseguir voltar ao menu.
      //
      // Uma saudaÃ§Ã£o nÃ£o Ã© pedido de nada: um "bom dia" deixado no ar
      // acordava o dono de madrugada sem haver nada para responder. O cliente
      // continua no estado humano e a conversa real chega ao admin logo a
      // seguir.
      if (isSaudacao(text)) {
        console.log(`[MSG] saudaÃ§Ã£o ignorada de ${client.whatsapp_number} (estado humano)`);
        return;
      }
      //
      // O encaminhamento ao admin nÃ£o pode derrubar a mensagem do cliente: um
      // nÃºmero invÃ¡lido ou um token expirado fariam a excepÃ§Ã£o sair daqui e a
      // mensagem nunca chegava a lado nenhum.
      for (const numero of numerosAdmin) {
        try {
          await sendTextMessage(numero, `ðŸ“© *Mensagem de ${client.nome || "Cliente"} (${client.whatsapp_number}):*\n${text}\n\n_Responda usando: !responder ${client.whatsapp_number} sua mensagem_`, tenant);
        } catch (err) {
          console.error(`[ADMIN] nÃ£o consegui entregar a mensagem em ${numero}: ${err.message}`);
        }
      }
      return; // nÃ£o envia feedback automÃ¡tico ao cliente
    case "menu":
    default:
      return routeMenu(client, lower, send, tenant, isAdmin);
  }
}

function routeMenu(client, lower, send, tenant, isAdmin = false) {
  if (lower === "1" || lower.includes("cotaÃ§Ã£o") || lower.includes("cotacao")) {
    return startCotacao(client, send);
  }
  if (lower === "2" || lower.includes("plano") || lower.includes("preÃ§o") || lower.includes("preco")) {
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
  if (lower === "6" || lower.includes("demonstraÃ§Ã£o") || lower.includes("demonstracao") || lower.includes("agendar") || lower.includes("qualificacao")) {
    return startSDR(client, send, tenant);
  }
  if (lower === "8" || lower.includes("vuka") || lower.includes("jornal") || lower.includes("noticias")) {
    return startVuka(client, send);
  }
  if (lower === "7" || lower.includes("doremi") || lower.includes("album") || lower.includes("Ã¡lbum") || lower.includes("albuns") || lower.includes("Ã¡lbuns")) {
    return startDoremi(client, send);
  }
  // "bom dia", "tudo bem", "e aÃ­": o cliente estÃ¡ a dizer olÃ¡, nÃ£o a
  // escolher uma opÃ§Ã£o. Sem isto, respondia "NÃ£o entendi o seu pedido" a uma
  // saudaÃ§Ã£o â€” e era isso que o fez parecer um bot mudo.
  if (isSaudacao(lower)) {
    return responderSaudacao(client, send);
  }
  // Fallback inteligente: se a IA estiver activa, responde com GPT em vez
  // de "NÃ£o entendi". Se nÃ£o estiver configurada, comportamento anterior.
  if (isAiEnabled()) {
    return handleAiMessage(client, lower, send, tenant);
  }
  return sendMenu(send, client.nome, isAdmin);
}


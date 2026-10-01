import { MENU } from "./menu.js";

/**
 * Saudações e conversa de entrada que o bot tem de acolher.
 *
 * Antes só respondia a "olá", "oi", "hey" e "menu", e mesmo isso apenas
 * quando a mensagem era exactamente igual à palavra. Um "bom dia", um "tudo
 * bem", um "olá, tudo bem?" ou um "e aí" caíam no "Não entendi o seu pedido"
 * — que é o que faz um bot parecer mudo. Aqui ficam essas expressões.
 */

/**
 * Tira acentos, pontuação e maiúsculas. No WhatsApp é comum escrever
 * "ola", "Bom dia", "tudo bem ?" — o teste tem de sobreviver a isso.
 */
function normalizar(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Expressões de saudação e de conversa de entrada. São usadas para APAGAR
 * essas palavras do texto, não para o aceitar: o que decide é o que sobra
 * depois de as remover.
 *
 * A ordem conta: as de várias palavras vêm primeiro. Se "tranquilo" fosse
 * apagado antes de "tudo tranquilo", sobrava um "tudo" solto e a saudação
 * deixava de ser reconhecida.
 */
const EXPRESSOES = [
  // "e aí", "e ai", "eai", "e-ai"
  /\be\s*a[ií]\b/g,
  // "bom dia", "boa tarde", "boa noite", "boa madrugada", "boa manhã"
  /\b(bom|boa)\s+(dia|tarde|noite|madrugada|manha)\b/g,
  // "tudo bem", "tudo bom", "tá tudo certo", "tudo tranquilo"
  /\b(tud[eo]|ta)\s+(bem|bom|certo|tranquil[oa]|igual|normal)\b/g,
  // "como vai", "como está", "como andas", "como foi"
  /\bcomo\s+(vai|est[a]s?|and[a]s?|estou|foi)\b/g,
  // "olá", "ola", "oi", "opa", "hey", "alô", "salve", "ciao", "bv", "blz", "beleza"
  /\b(ol[ao]|oi+|opa|hey|al[oô]|salve|c[ií]ao|bv|bzl|blz|beleza|show|suave|tranquil[oa])\b/g,
];

/** Palavras que sozinhas não são pedido nenhum. */
const VAZIO = new Set([
  "e", "a", "o", "as", "os", "um", "uma", "por", "favor", "fav", "obrigado", "obg",
  "ate", "ja", "muito", "mui", "bem", "de", "da", "do", "ai", "aqui", "entao", "la", "ta",
  "sr", "sra", "d", "dona", "senhor", "senhora", "mr", "mra", "amigo", "amiga",
]);

/**
 * Diz se a mensagem é só uma saudação.
 *
 * A regra é "saudação é o que não deixa nada para trás": apagamos as palavras
 * de saudação e, se sobrar pedido nenhum, era uma saudação. É assim que
 * "bom dia" e "olá, tudo bem?" são saudações mas "olá, quero ver os planos"
 * e "bom dia, queria saber o preço" continuam a ser pedidos — um "olá" no
 * início não pode engolir a pergunta que vinha a seguir.
 */
export function isSaudacao(text) {
  const normal = normalizar(text);
  if (!normal) return false;

  // Um número solto é escolha de menu, mesmo numa frase: "olá 5" é a opção 5.
  if (/\b[1-9]\b/.test(normal)) return false;

  let resto = normal;
  for (const re of EXPRESSOES) resto = resto.replace(re, " ");

  return resto
    .split(" ")
    .filter((p) => p && !VAZIO.has(p))
    .length === 0;
}

/** Hora em Moçambique (UTC+2) para cumprimentar à hora certa. */
function horaMaputo() {
  const hora = Number(
    new Intl.DateTimeFormat("pt-PT", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Maputo",
    }).format(new Date())
  );
  return Number.isFinite(hora) ? hora % 24 : 12;
}

function saudacaoPorHora() {
  const hora = horaMaputo();
  if (hora >= 5 && hora < 12) return "Bom dia ☀️";
  if (hora >= 12 && hora < 18) return "Boa tarde 🌤️";
  return "Boa noite 🌙";
}

/**
 * Acolhe a saudação e mostra o menu. Sem isto o cliente fica a falar sozinho.
 */
export function responderSaudacao(client, send) {
  const nome = (client && client.nome) || "";
  return send(
    `${saudacaoPorHora()}${nome ? `, ${nome}` : ""}! 👋\n\n` +
      "Sou o assistente da TECNOINCUBADORA. Diga-me o que precisa:\n\n" +
      MENU +
      '\n\n(escreva "0" para voltar ao menu)'
  );
}

/**
 * Saudação a meio de um fluxo (ex.: o cliente ia a meio de uma cotação e
 * mandou "bom dia"). Não se mexe no estado — deitar fora o que o cliente já
 * preencheu para-ir "cumprimentar" era pior do que a falta de resposta.
 */
export function responderSaudacaoEmFluxo(client, send) {
  const nome = (client && client.nome) || "";
  return send(
    `Olá${nome ? `, ${nome}` : ""}! 👋\n\n` +
      "Continuamos onde parámos. Se quiser recomeçar, escreva *menu* ou *0*."
  );
}

import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";

let _genAI = null;

/**
 * Devolve o cliente Gemini (singleton lazy).
 * Usa GEMINI_API_KEY — gratuito em aistudio.google.com
 */
function getClient() {
  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY não configurado — plataforma AI inactiva.");
  }
  if (!_genAI) {
    _genAI = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return _genAI;
}

/** Verdadeiro se a IA estiver configurada e disponível. */
export function isAiEnabled() {
  return Boolean(env.geminiApiKey);
}

/**
 * System prompt base do TECNO_BOT.
 * Define a personalidade, limites e contexto do negócio.
 */
function buildSystemPrompt(tenant) {
  const tenantNome = (tenant && tenant.nome) || "TECNOINCUBADORA";
  return `És o assistente inteligente do ${tenantNome}, via WhatsApp.

PERSONALIDADE:
- Amigável, profissional e conciso
- Usas português de Moçambique (podes usar expressões locais com naturalidade se o cliente o fizer)
- Respondes sempre em português, a não ser que o cliente escreva noutra língua
- Nunca inventas preços, datas ou dados do cliente — se não souberes, dizes que vais verificar

CONHECIMENTO DO NEGÓCIO (${tenantNome}):
- Oferece sistemas de gestão SaaS: CredHubMZ, Xonguile, Gymar e outros
- Pagamentos aceites: M-Pesa, e-Mola e cartão (via PaySuite)
- Suporte humano disponível: o cliente pode pedir falar com um atendente real
- O menu principal tem: Cotação (1), Planos e Preços (2), Pagamento de Licença (3), Encomendar Sistema (4), Falar com Humano (5)

REGRAS:
- Se o cliente pedir cotação, preço ou quiser comprar → diz que podes ajudar e pede-lhe para escrever "1" para cotação ou "2" para ver planos
- Se o cliente tiver problema técnico urgente → sugere "5" para falar com atendente
- Nunca prometes funcionalidades que não existam
- Mantém respostas curtas (máx. 3 parágrafos no WhatsApp)
- Se não souberes a resposta → sê honesto e oferece transferir para humano`;
}

/**
 * Envia uma mensagem para o Gemini e devolve a resposta em texto.
 *
 * @param {string} userMessage  - A mensagem do cliente
 * @param {Array}  history      - Histórico [{role, parts}] (últimas N trocas)
 * @param {object} tenant       - Tenant actual (para personalizar o system prompt)
 * @returns {Promise<string>}   - Resposta da IA
 */
export async function askAI(userMessage, history = [], tenant = null) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    systemInstruction: buildSystemPrompt(tenant),
  });

  // Converte o histórico para o formato do Gemini
  const geminiHistory = history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));

  const chat = model.startChat({ history: geminiHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text().trim();
}

/**
 * Classifica a intenção de uma mensagem (sem histórico — chamada única).
 *
 * @param {string} message
 * @returns {Promise<{intent: string, confidence: number, entities: object}>}
 */
export async function classifyIntent(message) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `Classifica a intenção desta mensagem de um cliente de software de gestão.
Responde APENAS com JSON válido neste formato exacto:
{"intent":"saudacao|cotacao|preco|pagamento|suporte|reclamacao|cobranca|agendamento|outro","confidence":0.9,"entities":{"empresa":null,"produto":null,"urgencia":"baixa"}}

Mensagem: "${message}"`;

  try {
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch {
    return { intent: "outro", confidence: 0.5, entities: { urgencia: "baixa" } };
  }
}

/**
 * Extrai dados estruturados de um texto (ex.: OCR de fatura, comprovante).
 *
 * @param {string} text   - Texto extraído do documento
 * @param {string} type   - "fatura" | "comprovante" | "contrato"
 * @returns {Promise<object>}
 */
export async function extractDocumentData(text, type = "fatura") {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const schemas = {
    fatura: `{"fornecedor":"","nif":"","data":"","total":0,"moeda":"MZN","items":[]}`,
    comprovante: `{"banco":"","referencia":"","valor":0,"data":"","remetente":"","destinatario":""}`,
    contrato: `{"partes":[],"objeto":"","valor":0,"inicio":"","fim":""}`,
  };

  const prompt = `Extrai os dados do seguinte ${type} e responde APENAS com JSON válido neste formato:
${schemas[type] || schemas.fatura}
Usa null para campos não encontrados.

DOCUMENTO:
${text}`;

  try {
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  } catch {
    return {};
  }
}

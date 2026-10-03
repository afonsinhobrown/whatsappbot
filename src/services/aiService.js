import OpenAI from "openai";
import { env } from "../config/env.js";

let _client = null;

/**
 * Devolve o cliente OpenAI (singleton lazy).
 * Lança erro se OPENAI_API_KEY não estiver configurado.
 */
function getClient() {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY não configurado — plataforma AI inactiva.");
  }
  if (!_client) {
    _client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return _client;
}

/** Verdadeiro se a IA estiver configurada e disponível. */
export function isAiEnabled() {
  return Boolean(env.openaiApiKey);
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
- Usas português de Moçambique (podes usar "buédia", "xitique" com naturalidade se o cliente o fizer)
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
 * Envia uma mensagem para o modelo e devolve a resposta em texto.
 *
 * @param {string} userMessage  - A mensagem do cliente
 * @param {Array}  history      - Histórico [{role, content}] (últimas N trocas)
 * @param {object} tenant       - Tenant actual (para personalizar o system prompt)
 * @returns {Promise<string>}   - Resposta da IA
 */
export async function askAI(userMessage, history = [], tenant = null) {
  const client = getClient();

  const messages = [
    { role: "system", content: buildSystemPrompt(tenant) },
    ...history,
    { role: "user", content: userMessage },
  ];

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",          // rápido, barato, mais do que suficiente
    messages,
    max_tokens: 400,               // suficiente para WhatsApp; evita respostas longas
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content?.trim() || "Desculpa, não consegui processar a tua mensagem. Tenta de novo.";
}

/**
 * Classifica a intenção de uma mensagem.
 * Útil para o agente SDR e de cobrança.
 *
 * @param {string} message
 * @returns {Promise<{intent: string, confidence: number, entities: object}>}
 */
export async function classifyIntent(message) {
  const client = getClient();

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Classifica a intenção da mensagem de um cliente de software de gestão.
Responde APENAS com JSON válido neste formato:
{
  "intent": "saudacao|cotacao|preco|pagamento|suporte|reclamacao|cobranca|agendamento|outro",
  "confidence": 0.0-1.0,
  "entities": {
    "empresa": "nome da empresa se mencionado ou null",
    "produto": "produto mencionado ou null",
    "urgencia": "alta|media|baixa"
  }
}`,
      },
      { role: "user", content: message },
    ],
    max_tokens: 150,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    return { intent: "outro", confidence: 0.5, entities: { urgencia: "baixa" } };
  }
}

/**
 * Extrai dados estruturados de um texto (ex.: OCR de fatura).
 *
 * @param {string} text   - Texto extraído do documento
 * @param {string} type   - "fatura" | "comprovante" | "contrato"
 * @returns {Promise<object>}
 */
export async function extractDocumentData(text, type = "fatura") {
  const client = getClient();

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extrai os dados estruturados de um ${type} e devolve APENAS JSON válido.
Para fatura: { "fornecedor": "", "nif": "", "data": "", "total": 0, "moeda": "MZN", "items": [] }
Para comprovante: { "banco": "", "referencia": "", "valor": 0, "data": "", "remetente": "", "destinatario": "" }
Para contrato: { "partes": [], "objeto": "", "valor": 0, "inicio": "", "fim": "" }
Usa null para campos não encontrados.`,
      },
      { role: "user", content: `${type.toUpperCase()}:\n${text}` },
    ],
    max_tokens: 500,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    return {};
  }
}

import dotenv from "dotenv";

// Carrega .env.local (convenção Vercel/pull) e, se não existir, .env.
// Sem override: as variáveis já definidas no ambiente têm prioridade.
for (const path of [".env.local", ".env"]) {
  dotenv.config({ path });
}

export const env = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  appSecret: process.env.APP_SECRET || "",
  phoneNumberId: process.env.PHONE_NUMBER_ID || "",
  databaseUrl: process.env.DATABASE_URL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),
  // Números que recebem aviso de cada venda/pagamento (o dono, por exemplo).
  // Também entram aqui os de atendimento humano (ver adminNumbers()).
  adminNumbers: (process.env.ADMIN_NUMBERS || "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean),
  // Segredo do webhook da PaySuite (definições > API Access no painel).
  paysuiteWebhookSecret: process.env.PAYSUITE_WEBHOOK_SECRET || "",
  // OpenAI — motor de IA. Sem esta variável a plataforma AI fica desactivada
  // e o bot continua a funcionar exactamente como antes.
  openaiApiKey: process.env.OPENAI_API_KEY || "",
};

/**
 * Números de WhatsApp que recebem os avisos do bot (atendimento humano, vendas).
 *
 * Junta ADMIN_WHATSAPP_NUMBER e ADMIN_NUMBERS e descarta o que não é um número.
 * O filtro importa: sem ele, um valor em branco ou um placeholder ia parar à
 * Meta como destinatário, a Meta devolvia erro 400 e — porque o aviso ao admin
 * era enviado antes da resposta ao cliente — o cliente ficava sem resposta
 * nenhuma. Todos os números ficam em formato só com dígitos, com o 258 dos
 * números moçambicanos de 9 dígitos.
 */
export function adminNumbers() {
  const brutos = [process.env.ADMIN_WHATSAPP_NUMBER, ...(env.adminNumbers || [])];
  const vistos = new Set();
  for (const bruto of brutos) {
    let n = String(bruto || "").replace(/\D/g, "");
    if (n.length === 9) n = `258${n}`;
    if (n.length < 9 || n.length > 15) continue; // placeholder, vazio ou lixo
    vistos.add(n);
  }
  return [...vistos];
}

export function isMetaConfigured() {
  return Boolean(env.whatsappToken && env.phoneNumberId);
}

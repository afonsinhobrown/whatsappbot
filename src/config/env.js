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
  adminNumbers: (process.env.ADMIN_NUMBERS || "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean),
};

export function isMetaConfigured() {
  return Boolean(env.whatsappToken && env.phoneNumberId);
}

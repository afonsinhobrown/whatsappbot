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
};

export function isMetaConfigured() {
  return Boolean(env.whatsappToken && env.phoneNumberId);
}

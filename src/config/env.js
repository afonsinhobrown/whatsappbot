import "dotenv/config";

export const env = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.PHONE_NUMBER_ID || "",
  databaseUrl: process.env.DATABASE_URL || "",
};

export function isMetaConfigured() {
  return Boolean(env.whatsappToken && env.phoneNumberId);
}

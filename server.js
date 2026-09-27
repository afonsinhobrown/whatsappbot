import { pathToFileURL } from "url";
import app from "./src/app.js";
import { env } from "./src/config/env.js";

function start() {
app.listen(env.port, () => {
  console.log(`Servidor a correr em http://localhost:${env.port}`);
  console.log(`Webhook: http://localhost:${env.port}/webhook`);
  console.log(`Admin:   http://localhost:${env.port}/admin`);

  if (!env.verifyToken) {
    console.warn("[AVISO] VERIFY_TOKEN não definido no .env — a verificação da Meta vai falhar");
  }
  if (!env.whatsappToken || !env.phoneNumberId) {
    console.warn("[AVISO] WHATSAPP_TOKEN/PHONE_NUMBER_ID não definidos — envios ficarão em modo MOCK");
  }
  if (!env.appSecret) {
    console.warn("[AVISO] APP_SECRET não definido — assinatura do webhook não é validada");
  }
  if (!env.databaseUrl) {
    console.warn("[AVISO] DATABASE_URL não definida — o bot e o admin não terão dados");
  }
  if (!env.adminPassword) {
    console.warn("[AVISO] ADMIN_PASSWORD não definida — o painel /admin ficará inacessível");
  }
});
}

// Só arranca o servidor quando executado directamente (npm start / npm run dev).
// No Vercel, o app é servido por api/index.js.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  start();
}

export default app;

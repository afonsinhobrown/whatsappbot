import express from "express";
import helmet from "helmet";
import { env } from "./src/config/env.js";
import webhookRouter from "./src/routes/webhook.js";

const app = express();

// O Vercel termina o TLS e reencaminha o IP real via X-Forwarded-For.
// Necessário para o rate limiter funcionar corretamente atrás do proxy.
app.set("trust proxy", 1);

app.use(helmet());

// Mantém o corpo raw para validar a assinatura HMAC da Meta
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => {
  res.json({ service: "whatsappbot", status: "ok" });
});

app.use("/webhook", webhookRouter);

// Erros inesperados não derrubam o servidor
app.use((err, _req, res, _next) => {
  console.error("[ERRO]", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

app.listen(env.port, () => {
  console.log(`Servidor a correr em http://localhost:${env.port}`);
  console.log(`Webhook: http://localhost:${env.port}/webhook`);

  if (!env.verifyToken) {
    console.warn("[AVISO] VERIFY_TOKEN não definido no .env — a verificação da Meta vai falhar");
  }
  if (!env.whatsappToken || !env.phoneNumberId) {
    console.warn("[AVISO] WHATSAPP_TOKEN/PHONE_NUMBER_ID não definidos — envios ficarão em modo MOCK");
  }
  if (!env.databaseUrl) {
    console.warn("[AVISO] DATABASE_URL não definida — a usar base de dados DEMO em memória");
  }
});
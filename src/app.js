import express from "express";
import helmet from "helmet";
import webhookRouter from "./routes/webhook.js";
import adminRouter from "./routes/admin.js";
import { adminHtml } from "./admin/ui.js";
import { privacyHtml, dataDeletionHtml } from "./legal.js";
import { processarCobrancasDiarias } from "./cron/cobranca.js";

const app = express();

// O Vercel termina o TLS e reencaminha o IP real via X-Forwarded-For.
app.set("trust proxy", 1);

// A UI do admin usa estilos/scripts inline, por isso a CSP é desactivada.
app.use(helmet({ contentSecurityPolicy: false }));

// Mantém o corpo raw para validar a assinatura HMAC da Meta.
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

app.get("/admin", (_req, res) => {
  res.type("html").send(adminHtml);
});

app.get("/privacy", (_req, res) => {
  res.type("html").send(privacyHtml);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(dataDeletionHtml);
});

app.use("/admin/api", adminRouter);
app.use("/webhook", webhookRouter);

// Endpoint chamado pelo Vercel Cron
app.get("/cron/cobranca", async (req, res, next) => {
  try {
    // Vercel adiciona este header se o pedido vier do Cron Job deles.
    // Em produção, ajuda a proteger contra abusos (embora seja GET sem side-effects graves repetitivos)
    const authHeader = req.headers.authorization;
    if (process.env.VERCEL_ENV === "production" && authHeader !== \`Bearer \${process.env.CRON_SECRET}\`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const resultado = await processarCobrancasDiarias();
    res.json(resultado);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error("[ERRO]", err);
  res.status(err.status || 500).json({ error: err.message || "Erro interno" });
});

export default app;

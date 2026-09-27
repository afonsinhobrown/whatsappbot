import express from "express";
import helmet from "helmet";
import webhookRouter from "./routes/webhook.js";
import adminRouter from "./routes/admin.js";
import { adminHtml } from "./admin/ui.js";
import { privacyHtml, dataDeletionHtml } from "./legal.js";

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

app.use((err, _req, res, _next) => {
  console.error("[ERRO]", err);
  res.status(err.status || 500).json({ error: err.message || "Erro interno" });
});

export default app;

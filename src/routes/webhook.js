import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { handleIncomingMessage } from "../services/messageHandler.js";

const router = Router();

// Proteção simples contra abuso (30 pedidos por minuto por IP)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Demasiados pedidos — tente novamente mais tarde" },
});

/**
 * GET /webhook — Handshake de verificação.
 * A Meta faz este pedido quando configuras a callback URL no painel.
 * Se o verify_token bater certo, respondemos com o "challenge".
 */
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log(`[WEBHOOK] Handshake: mode=${mode} token=${token}`);

  if (mode === "subscribe" && token === env.verifyToken) {
    console.log("[WEBHOOK] Verificação aceite pela Meta");
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Falha na verificação do webhook");
});

/**
 * POST /webhook — Mensagens recebidas.
 * Respondemos 200 imediatamente (a Meta considera erro se tardar)
 * e processamos a mensagem em seguida.
 */
router.post("/", limiter, async (req, res) => {
  // Validar assinatura HMAC (prova que o pedido vem mesmo da Meta)
  if (env.whatsappToken && !isValidSignature(req)) {
    return res.status(401).send("Assinatura inválida");
  }

  const body = req.body || {};

  if (body.object !== "whatsapp_business_account") {
    return res.status(404).send("Objeto desconhecido");
  }

  // Confirmar receção à Meta primeiro
  res.status(200).send("EVENT_RECEIVED");

  // Processar cada entrada (vem 1 por mensagem/atualização de estado normalmente)
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;

      const value = change.value || {};
      const message = value.messages && value.messages[0];

      if (message && message.type === "text") {
        try {
          await handleIncomingMessage(message, value);
        } catch (err) {
          console.error("[WEBHOOK] Erro ao processar mensagem:", err);
        }
      }
    }
  }
});

/**
 * Verifica o cabeçalho X-Hub-Signature-256 usando o token do WhatsApp.
 * Requer o corpo raw da requisição (guardado no middleware do server.js).
 */
function isValidSignature(req) {
  const signatureHeader = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody;

  if (!signatureHeader || !rawBody) return false;

  const hmac = crypto.createHmac("sha256", env.whatsappToken);
  const digest = hmac.update(rawBody).digest("hex");
  const expected = `sha256=${digest}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export default router;
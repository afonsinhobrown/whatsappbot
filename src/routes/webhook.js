import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { handleIncomingMessage } from "../services/messageHandler.js";
import { getTenantByPhoneNumberId } from "../services/dbService.js";

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
  // A Meta assina o corpo com o App Secret da aplicação (não o WhatsApp token)
  if (env.appSecret && !isValidSignature(req)) {
    return res.status(401).send("Assinatura inválida");
  }

  const body = req.body || {};

  if (body.object !== "whatsapp_business_account") {
    return res.status(404).send("Objeto desconhecido");
  }

  // Processar primeiro (em serverless, responder antes faria o runtime
  // terminar a função antes de concluir a base de dados / envio).
  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;

        const value = change.value || {};
        const message = value.messages && value.messages[0];

        if (message && message.type === "text") {
          const phoneNumberId = value.metadata && value.metadata.phone_number_id;
          const tenant = await getTenantByPhoneNumberId(phoneNumberId);
          if (!tenant) {
            console.warn(`[WEBHOOK] Sem tenant para phone_number_id=${phoneNumberId}`);
            continue;
          }
          await handleIncomingMessage(message, value, tenant);
        }
      }
    }
  } catch (err) {
    console.error("[WEBHOOK] Erro ao processar mensagem:", err);
    console.error(
      "[WEBHOOK] O bot pode ter recebido a mensagem mas NÃO respondeu. " +
        "Confirma o estado do token em /admin/api/meta-status"
    );
  }

  // Confirmar receção à Meta
  return res.status(200).send("EVENT_RECEIVED");
});

/**
 * Verifica o cabeçalho X-Hub-Signature-256 usando o App Secret da aplicação Meta.
 * Requer o corpo raw da requisição (guardado no middleware do server.js).
 */
function isValidSignature(req) {
  const signatureHeader = req.headers["x-hub-signature-256"];
  const rawBody = req.rawBody;

  if (!signatureHeader || !rawBody) return false;

  const hmac = crypto.createHmac("sha256", env.appSecret);
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
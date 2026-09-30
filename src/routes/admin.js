import { Router } from "express";
import crypto from "crypto";
import { env } from "../config/env.js";
import {
  getSchema,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  isDbConfigured,
} from "../services/dbService.js";
import { sendTextMessage } from "../services/metaApi.js";
import { confirmarPagamento } from "../flows/pagamento.js";

const router = Router();
const COOKIE = "tecno_admin";
const GRAPH_API_VERSION = "v20.0";

function sessionToken() {
  return crypto
    .createHmac("sha256", env.adminPassword || "sem-password")
    .update("tecno-admin-v1")
    .digest("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  });
  return cookies;
}

function isAuthed(req) {
  if (!env.adminPassword) return false;
  const value = parseCookies(req)[COOKIE];
  if (!value) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(value),
      Buffer.from(sessionToken())
    );
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
}

router.post("/login", (req, res) => {
  if (!env.adminPassword) {
    return res
      .status(500)
      .json({ error: "ADMIN_PASSWORD não configurada no servidor" });
  }

  const password = String((req.body && req.body.password) || "");
  const expected = env.adminPassword;

  const ok =
    password.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));

  if (!ok) {
    return res.status(401).json({ error: "Password incorrecta" });
  }

  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${sessionToken()}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
  );
  res.json({ ok: true });
});

router.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

router.get("/tables", requireAuth, async (_req, res, next) => {
  try {
    if (!isDbConfigured()) {
      return res.status(500).json({ error: "DATABASE_URL não configurada" });
    }
    const tables = await getSchema();
    res.json({ tables });
  } catch (err) {
    next(err);
  }
});

router.get("/rows", requireAuth, async (req, res, next) => {
  try {
    const rows = await listRows(req.query.table);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/rows", requireAuth, async (req, res, next) => {
  try {
    const row = await insertRow(req.query.table, req.body || {});
    res.status(201).json({ row });
  } catch (err) {
    next(err);
  }
});

router.put("/rows", requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const row = await updateRow(req.query.table, body.id, body);
    res.json({ row });
  } catch (err) {
    next(err);
  }
});

router.delete("/rows", requireAuth, async (req, res, next) => {
  try {
    const id = (req.body && req.body.id) || req.query.id;
    await deleteRow(req.query.table, id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Diagnóstico do canal WhatsApp: valida o WHATSAPP_TOKEN e o
 * PHONE_NUMBER_ID do ambiente contra a Graph API. Devolve o estado
 * da ligação sem nunca revelar o token.
 */
router.get("/meta-status", requireAuth, async (_req, res) => {
  const token = env.whatsappToken;
  const phoneNumberId = env.phoneNumberId;

  if (!token || !phoneNumberId) {
    return res.json({
      configured: false,
      motivo: "WHATSAPP_TOKEN ou PHONE_NUMBER_ID não definidos no ambiente",
    });
  }

  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}` +
    "?fields=display_phone_number,verified_name,quality_rating";

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    if (!response.ok || body.error) {
      return res.status(502).json({
        configured: true,
        ok: false,
        phone_number_id: phoneNumberId,
        erro: body.error || { http_status: response.status },
      });
    }

    return res.json({
      configured: true,
      ok: true,
      phone_number_id: phoneNumberId,
      numero: body.display_phone_number,
      nome_verificado: body.verified_name,
      qualidade: body.quality_rating,
    });
  } catch (err) {
    res.status(502).json({ configured: true, ok: false, erro: err.message });
  }
});

/**
 * Envia uma mensagem de teste pelo mesmo caminho do bot, para confirmar
 * que o envio funciona ponta a ponta.
 */
router.post("/meta-test-send", requireAuth, async (req, res) => {
  const to = String((req.body && req.body.to) || "").trim();
  const text = String((req.body && req.body.text) || "Teste TECNOINCUBADORA").trim();

  if (!to) {
    return res.status(400).json({ error: "Indica o destinatário no campo 'to'" });
  }

  try {
    res.json({ ok: true, result: await sendTextMessage(to, text) });
  } catch (err) {
    res.status(502).json({ ok: false, erro: err.message });
  }
});

/**
 * Webhook da PaySuite: a PaySuite avisa aqui quando um pagamento é
 * confirmado. Não exige login (é a PaySuite que chama), por isso valida
 * o pedido contra a API antes de confiar nele.
 */
router.post("/paysuite-webhook", async (req, res) => {
  const body = req.body || {};
  const data = body.data || body;
  const paysuiteId = data.id || data.payment_id || data.payment;
  const evento = String(body.event || "").toLowerCase();

  // A PaySuite assina o corpo com X-Signature (HMAC-SHA256 do webhook secret).
  // Sem esta validação, qualquer pessoa poderia forjar um "pagamento".
  if (env.paysuiteWebhookSecret) {
    const assinatura = req.headers["x-signature"];
    if (!assinatura || !req.rawBody) {
      return res.status(401).json({ error: "assinatura ausente" });
    }
    const esperada = crypto
      .createHmac("sha256", env.paysuiteWebhookSecret)
      .update(req.rawBody)
      .digest("hex");
    const ok =
      assinatura.length === esperada.length &&
      crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada));
    if (!ok) return res.status(401).json({ error: "assinatura inválida" });
  } else {
    console.warn("[PAYSUITE] PAYSUITE_WEBHOOK_SECRET não definido: webhook aceite sem validação");
  }

  console.log(`[PAYSUITE] webhook: evento=${evento || "(sem evento)"} id=${paysuiteId}`);

  if (!paysuiteId) {
    return res.status(400).json({ error: "pedido sem id" });
  }

  // Só o evento de sucesso é motivo para verificar. Pagamentos falhados,
  // estornos e outros eventos não activam nada.
  if (evento && evento !== "payment.success") {
    return res.json({ ok: true, accao: "ignorado", evento });
  }

  // O webhook é apenas um aviso. Quem confirma é o confirmarPagamento(),
  // que vai perguntar à PaySuite se o dinheiro entrou.
  try {
    const r = await confirmarPagamento(paysuiteId);

    // Ainda não pago: normal, o cliente pode estar a concluir o checkout.
    // A PaySuite avisa de novo quando mudar.
    if (!r.ok && r.motivo === "pagamento ainda não confirmado") {
      return res.json({ ok: true, accao: "aguarda_pagamento", paysuite_status: r.paysuite_status });
    }
    if (!r.ok) return res.status(404).json(r);
    if (r.jaConfirmado) return res.json({ ok: true, accao: "ja_confirmado" });

    // Avisa o cliente no WhatsApp.
    if (r.whatsapp) {
      try {
        await sendTextMessage(
          r.whatsapp,
          `✅ *Pagamento confirmado!*\n\n` +
            `${r.produto || "Licença"} — ${r.plano || ""}\n` +
            `Valor: ${Number(r.valor).toLocaleString("pt-MZ", { minimumFractionDigits: 2 })} MZN\n\n` +
            `A sua licença está activa até ${r.data_expiracao.slice(0, 10)}.\n` +
            (r.sausActivado === true
              ? "A sua conta no sistema já foi actualizada."
              : r.sausActivado === false
                ? "A conta no sistema será actualizada pela nossa equipa."
                : "")
        );
      } catch (err) {
        console.error("[PAYSUITE] não consegui avisar o cliente:", err.message);
      }
    }

    return res.json({ ok: true, accao: "licenca_activada", ...r });
  } catch (err) {
    console.error("[PAYSUITE] erro ao confirmar pagamento:", err);
    // Se a PaySuite recusou as credenciais, há clientes que pagaram e vão
    // ficar sem licença. O dono tem de saber já, não no fim do mês.
    if (/unauthenticated|forbidden|401|403/i.test(err.message)) {
      const aviso =
        `🚨 *Pagamento recebido mas não confirmado*\n\n` +
        `A PaySuite recusou o pedido ${paysuiteId}: ${err.message}\n\n` +
        `Há um cliente que pagou e a licença não foi activada. ` +
        "Actualiza PAYSUITE_API_TOKEN no Vercel e confirma o pagamento à mão.";
      for (const numero of env.adminNumbers) {
        try {
          await sendTextMessage(numero, aviso);
        } catch (e) {
          console.error("[PAYSUITE] não consegui avisar o dono:", e.message);
        }
      }
    }
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

export default router;

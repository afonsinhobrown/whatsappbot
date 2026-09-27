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

export default router;

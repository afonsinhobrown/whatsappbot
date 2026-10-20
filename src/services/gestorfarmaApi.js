import { env } from "../config/env.js";

let accessToken = null;
let loginPromise = null;

export function gestorFarmaConfigurado() {
  return Boolean(
    env.gestorfarmaApiUrl &&
      env.gestorfarmaBotEmail &&
      env.gestorfarmaBotPassword
  );
}

function base() {
  if (!gestorFarmaConfigurado()) {
    throw new Error(
      "Integração com o GestorFarma não configurada (GESTORFARMA_API_URL, " +
        "GESTORFARMA_BOT_EMAIL, GESTORFARMA_BOT_PASSWORD)"
    );
  }
  return env.gestorfarmaApiUrl.replace(/\/+$/, "");
}

async function login() {
  if (accessToken) return accessToken;
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const res = await fetch(`${base()}/auth/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: env.gestorfarmaBotEmail,
        password: env.gestorfarmaBotPassword,
      }),
    });

    if (!res.ok) {
      const detalhe = await res.text();
      throw new Error(`Login GestorFarma ${res.status}: ${detalhe.slice(0, 300)}`);
    }

    const data = await res.json();
    if (!data.access) throw new Error("GestorFarma não devolveu token de acesso");
    accessToken = data.access;
    return accessToken;
  })().finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}

async function request(path, { method = "GET", body, raw = false, auth = true } = {}) {
  const url = `${base()}${path}`;

  const send = async () => {
    const headers = {};
    if (auth) headers.Authorization = `Bearer ${await login()}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await send();

  // Token expirado: renova uma vez e repete.
  if (auth && res.status === 401) {
    accessToken = null;
    res = await send();
  }

  if (!res.ok) {
    const detalhe = await res.text();
    const erro = new Error(
      `GestorFarma ${res.status} em ${path}: ${detalhe.slice(0, 400)}`
    );
    erro.status = res.status;
    throw erro;
  }

  if (raw) return Buffer.from(await res.arrayBuffer());
  if (res.status === 204) return null;

  const tipo = res.headers.get("content-type") || "";
  return tipo.includes("application/json") ? res.json() : res.text();
}

/* --- Leitura --- */

export const getMinhaFarmacia = () => request("/farmacias/me/");

export const getReport = (inicio, fim) =>
  request(
    `/farmacias/dashboard/report/?data_inicio=${encodeURIComponent(
      inicio
    )}&data_fim=${encodeURIComponent(fim)}`
  );

export const getCaixaHistorico = (inicio, fim) =>
  request(
    `/caixa/historico/?data_inicio=${encodeURIComponent(
      inicio
    )}&data_fim=${encodeURIComponent(fim)}`
  );

export const getEstoque = (search = "") =>
  request(
    `/produtos/meu-estoque/${search ? `?search=${encodeURIComponent(search)}` : ""}`
  );

export const getCotacoes = (status = "") =>
  request(`/cotacoes/${status ? `?status=${encodeURIComponent(status)}` : ""}`);

/* --- Cotações --- */

export const criarCotacao = (payload) =>
  request("/cotacoes/", { method: "POST", body: payload });

export const getCotacaoPdf = (id) => request(`/cotacoes/${id}/pdf/`, { raw: true });

export const enviarCotacaoEmail = (id, payload = {}) =>
  request(`/cotacoes/${id}/email/`, { method: "POST", body: payload });

/* --- Avisos de cobrança --- */

export const emitirAviso = (cotacaoId, payload = {}) =>
  request(`/cotacoes/${cotacaoId}/avisos/`, { method: "POST", body: payload });

export const getAvisoPdf = (id) =>
  request(`/cotacoes/avisos/${id}/pdf/`, { raw: true });

export const enviarAvisoEmail = (id, payload = {}) =>
  request(`/cotacoes/avisos/${id}/email/`, { method: "POST", body: payload });

/* --- Relatórios em PDF --- */

export const getVendasPdf = (inicio, fim) =>
  request(
    `/pedidos/relatorios/vendas-pdf/?data_inicio=${encodeURIComponent(
      inicio
    )}&data_fim=${encodeURIComponent(fim)}`,
    { raw: true }
  );

export const getBiPdf = (meses = 6) =>
  request(`/pedidos/relatorios/bi-pdf/?meses=${Number(meses) || 6}`, {
    raw: true,
  });

export const getFinanceiroPdf = () =>
  request("/financeiro/relatorios/pdf/", { raw: true });

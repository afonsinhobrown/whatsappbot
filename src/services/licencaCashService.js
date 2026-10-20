import crypto from "crypto";
import { query } from "./dbService.js";
import {
  SISTEMAS_LICENCA_CASH,
  definirDataFimLicenca,
} from "./saasService.js";

let cashTableReady = false;

/**
 * Cria a tabela dos talões na primeira utilização. Fica aqui (e não só na
 * migração SQL) para a funcionalidade funcionar assim que for publicada.
 */
export async function ensureCashTable() {
  if (cashTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS licencas_cash (
      id                 BIGSERIAL PRIMARY KEY,
      referencia         TEXT UNIQUE NOT NULL,
      sistema            TEXT NOT NULL,
      conta_id           TEXT,
      conta_nome         TEXT NOT NULL,
      conta_email        TEXT,
      data_fim_anterior  TEXT,
      data_fim_nova      TEXT NOT NULL,
      valor              NUMERIC(12,2),
      observacao         TEXT,
      criado_em          TIMESTAMPTZ DEFAULT now()
    )
  `);
  cashTableReady = true;
}

export function erroCash(mensagem) {
  return Object.assign(new Error(mensagem), { status: 400 });
}

export function dataCashValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

function referenciaCash() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `CASH-${stamp}-${rand}`;
}

/**
 * Aplica uma licença paga em cash: actualiza a data-fim no sistema de destino
 * e grava o talão de conferência na base do bot.
 *
 * É usada pelo painel admin e pelo comando `!licenca` do WhatsApp, para que
 * os dois caminhos escrevam exactamente da mesma forma.
 */
export async function aplicarLicencaCash({
  sistema,
  contaId,
  contaNome,
  contaEmail = null,
  dataFim,
  valor = null,
  observacao = null,
}) {
  const sis = String(sistema || "").toUpperCase();
  if (!SISTEMAS_LICENCA_CASH[sis]) throw erroCash("Sistema inválido");

  const id = String(contaId || "").trim();
  if (!id) throw erroCash("Conta em falta");

  const nome = String(contaNome || "").trim();
  if (!nome) throw erroCash("Nome do tenant em falta");

  const data = String(dataFim || "").trim();
  if (!dataCashValida(data)) throw erroCash("Data-fim inválida (use AAAA-MM-DD)");

  const valorPago =
    valor === null || valor === undefined || valor === "" ? null : Number(valor);
  if (valorPago !== null && (!Number.isFinite(valorPago) || valorPago < 0)) {
    throw erroCash("Valor pago inválido");
  }

  // A tabela do talão é preparada antes de mexer na licença: se a base do bot
  // estiver indisponível, não se altera nada no sistema do cliente.
  await ensureCashTable();

  const resultado = await definirDataFimLicenca(sis, id, data, valorPago);

  const { rows } = await query(
    `INSERT INTO licencas_cash
       (referencia, sistema, conta_id, conta_nome, conta_email,
        data_fim_anterior, data_fim_nova, valor, observacao)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      referenciaCash(),
      sis,
      id,
      nome,
      contaEmail ? String(contaEmail) : null,
      resultado.anterior || null,
      data,
      valorPago,
      observacao ? String(observacao).slice(0, 500) : null,
    ]
  );

  console.log(
    `[CASH] ${sis} — ${nome} (${id}): ` +
      `${String(resultado.anterior || "?").slice(0, 10)} -> ${data}`
  );

  return rows[0];
}

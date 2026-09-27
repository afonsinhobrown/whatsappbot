import pg from "pg";
import { env } from "../config/env.js";

/**
 * Tabelas de negócio geridas pelo painel admin.
 * Qualquer operação do admin é validada contra esta lista (evita SQL injection
 * a partir do nome da tabela).
 */
export const TABLES = [
  "tenants",
  "clientes",
  "produtos",
  "planos",
  "licencas",
  "cotacoes",
  "orcamentos",
  "encomendas",
  "pagamentos",
  "bot_sessoes",
];

let pool = null;
if (env.databaseUrl) {
  pool = new pg.Pool({
    connectionString: cleanConnectionString(env.databaseUrl),
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
}

/**
 * Remove parâmetros que o node-postgres não interpreta bem
 * (sslmode/channel_binding) — o SSL é configurado explicitamente abaixo.
 * Evita o aviso de segurança do pg-connection-string no stderr.
 */
function cleanConnectionString(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function isDbConfigured() {
  return Boolean(pool);
}

export function query(text, params) {
  return requireDb().query(text, params);
}

function requireDb() {
  if (!pool) {
    throw new Error("DATABASE_URL não definida — sem ligação à base de dados");
  }
  return pool;
}

/**
 * Normaliza um número de WhatsApp: apenas dígitos, com código do país.
 * Números moçambicanos com 9 dígitos recebem o prefixo 258.
 */
export function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `258${digits}`;
  return digits;
}

// --- Tenants (negócios que têm um bot) ---

/**
 * Resolve o tenant pelo phone_number_id que recebeu a mensagem.
 * Fallback: o tenant do PHONE_NUMBER_ID do ambiente, ou o primeiro activo.
 */
export async function getTenantByPhoneNumberId(phoneNumberId) {
  const db = requireDb();
  const candidates = [phoneNumberId, env.phoneNumberId].filter(Boolean);
  for (const id of candidates) {
    const { rows } = await db.query(
      "SELECT * FROM tenants WHERE phone_number_id = $1 AND ativo = true LIMIT 1",
      [String(id)]
    );
    if (rows[0]) return rows[0];
  }
  const { rows } = await db.query(
    "SELECT * FROM tenants WHERE ativo = true ORDER BY id LIMIT 1"
  );
  return rows[0] || null;
}

export async function getTenantById(id) {
  const { rows } = await requireDb().query("SELECT * FROM tenants WHERE id = $1 LIMIT 1", [id]);
  return rows[0] || null;
}

// --- Clientes (usado pelo bot) ---

/**
 * Devolve o cliente do tenant pelo número de WhatsApp, criando o registo
 * se ainda não existir (primeira mensagem).
 */
export async function getClientByWhatsapp(tenantId, number) {
  const db = requireDb();
  const whatsappNumber = normalizePhone(number);

  const found = await db.query(
    "SELECT * FROM clientes WHERE tenant_id = $1 AND whatsapp_number = $2 LIMIT 1",
    [tenantId, whatsappNumber]
  );
  if (found.rows[0]) return found.rows[0];

  const created = await db.query(
    `INSERT INTO clientes (tenant_id, whatsapp_number, ultima_interacao)
     VALUES ($1, $2, now())
     RETURNING *`,
    [tenantId, whatsappNumber]
  );
  return created.rows[0];
}

export async function touchClient(clientId) {
  const db = requireDb();
  await db.query(
    "UPDATE clientes SET ultima_interacao = now() WHERE id = $1",
    [clientId]
  );
}

/**
 * Grava o nome de perfil do WhatsApp, apenas se o cliente ainda não tiver nome.
 */
export async function setClientName(clientId, nome) {
  if (!nome) return;
  const db = requireDb();
  await db.query(
    "UPDATE clientes SET nome = $2 WHERE id = $1 AND (nome IS NULL OR nome = '')",
    [clientId, nome]
  );
}

// --- Admin: introspecção do schema ---

let schemaCache = null;

export async function getSchema() {
  if (schemaCache) return schemaCache;

  const db = requireDb();
  const { rows } = await db.query(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position`,
    [TABLES]
  );

  const schema = {};
  for (const row of rows) {
    if (!schema[row.table_name]) schema[row.table_name] = [];
    schema[row.table_name].push({
      column: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
    });
  }
  schemaCache = schema;
  return schema;
}

function assertTable(table) {
  if (!TABLES.includes(table)) {
    throw Object.assign(new Error(`Tabela inválida: ${table}`), { status: 400 });
  }
}

async function assertColumns(table, columns) {
  const schema = await getSchema();
  for (const column of columns) {
    if (!schema[table] || !schema[table].some((c) => c.column === column)) {
      throw Object.assign(new Error(`Coluna inválida: ${table}.${column}`), {
        status: 400,
      });
    }
  }
}

// --- Admin: CRUD genérico (validado) ---

export async function listRows(table, limit = 200) {
  assertTable(table);
  const db = requireDb();
  const { rows } = await db.query(
    `SELECT * FROM "${table}" ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function insertRow(table, data) {
  assertTable(table);
  const entries = Object.entries(data || {}).filter(([key]) => key !== "id");
  if (entries.length === 0) {
    throw Object.assign(new Error("Sem campos para inserir"), { status: 400 });
  }
  await assertColumns(table, entries.map(([key]) => key));

  const db = requireDb();
  const columns = entries.map(([key]) => `"${key}"`).join(", ");
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);

  const { rows } = await db.query(
    `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return rows[0];
}

export async function updateRow(table, id, data) {
  assertTable(table);
  const entries = Object.entries(data || {}).filter(
    ([key]) => key !== "id" && key !== "created_at"
  );
  if (entries.length === 0) {
    throw Object.assign(new Error("Sem campos para actualizar"), { status: 400 });
  }
  await assertColumns(table, entries.map(([key]) => key));

  const db = requireDb();
  const sets = entries.map(([key], i) => `"${key}" = $${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(id);

  const { rows } = await db.query(
    `UPDATE "${table}" SET ${sets} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function deleteRow(table, id) {
  assertTable(table);
  const db = requireDb();
  await db.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
  return true;
}

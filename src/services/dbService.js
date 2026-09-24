import pg from "pg";
import { env } from "../config/env.js";

// Se DATABASE_URL estiver definida usa Neon/Postgres; caso contrário DEMO
let pool = null;
const mockClients = [
  { phone: "258840000001", name: "Ana", product: "CredHubMZ", balance: 15000.0 },
  { phone: "258840000002", name: "Carlos", product: "Xonguile", balance: 350.0 },
  { phone: "258840000003", name: "Marta", product: "Gymar", balance: 8700.5 },
];

if (env.databaseUrl) {
  pool = new pg.Pool({ connectionString: env.databaseUrl, ssl: { rejectUnauthorized: false } });
}

/**
 * Normaliza um número para o formato usado na base de dados:
 * apenas dígitos, com código do país (258 por defeito para Moçambique).
 */
export function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.length === 9) digits = `258${digits}`;
  return digits;
}

/**
 * Procura um cliente pelo número de telemóvel.
 * Em produção consulta a tabela `clientes` no Neon.
 * Sem DATABASE_URL usa a base de dados DEMO em memória.
 */
export async function getClientByPhone(phone) {
  const normalized = normalizePhone(phone);

  if (pool) {
    const result = await pool.query(
      `SELECT id, phone, name, product, balance
         FROM clientes
        WHERE phone = $1
        LIMIT 1`,
      [normalized]
    );
    return result.rows[0] || null;
  }

  return (
    mockClients.find((client) => client.phone === normalized) || null
  );
}
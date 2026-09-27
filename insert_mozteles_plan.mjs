import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "" });

async function run() {
  try {
    const res = await pool.query(`
      INSERT INTO planos (tenant_id, produto_id, nome_plano, preco, moeda, periodo, ativo)
      VALUES (1, 4, 'moz teles', 3000, 'MZN', 'mensal', true)
      RETURNING *;
    `);
    console.log("Inserido:", res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();

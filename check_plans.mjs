import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "" });

async function run() {
  try {
    const res = await pool.query(`SELECT id, produto_id, nome_plano, preco FROM planos WHERE nome_plano ILIKE '%moz teles%' OR nome_plano ILIKE '%mozteles%' OR preco = '10000.00'`);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();

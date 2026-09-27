import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || "" });

async function run() {
  try {
    const res = await pool.query(`SELECT l.*, p.nome_plano, p.preco, p.produto_id FROM licencas l JOIN planos p ON l.plano_id = p.id WHERE l.saas_user ILIKE '%moztele%' OR l.saas_user ILIKE '%ffmondlane%' ORDER BY l.id DESC LIMIT 5`);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();

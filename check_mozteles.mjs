import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.ARMAZEM_DB_URL || "" });

async function run() {
  try {
    const res = await pool.query("SELECT id, email, company_name, plan, trial_ends_at FROM users WHERE email ILIKE '%ffmondlane@moztelesolucoes.co.mz%' OR email ILIKE '%moztele%'");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();

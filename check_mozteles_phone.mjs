import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.ARMAZEM_DB_URL || "" });

async function run() {
  try {
    const res = await pool.query(`SELECT email, company_name, company_phone FROM users WHERE email ILIKE '%moztele%'`);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();

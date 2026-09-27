import { pool2 } from './src/config/database.js';

async function run() {
  try {
    const res = await pool2.query("SELECT id, email, company_name, plan, trial_ends_at FROM users WHERE email = 'ffmondlane@moztelesolucoes.co.mz'");
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool2.end();
  }
}

run();

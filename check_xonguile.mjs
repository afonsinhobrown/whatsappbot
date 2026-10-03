import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
const { Client } = pg;

async function check() {
  const url = process.env.XONGUILE_SUPABASE_URL || process.env.XONGUILE_NEON_URL;
  if (!url) { console.log('No URL for XONGUILE'); process.exit(1); }
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log("XONGUILE Tables:");
  console.log(res.rows.map(r => r.table_name));

  if (res.rows.find(r => r.table_name === 'Users')) {
     const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='Users'");
     console.log("Users columns:", cols.rows.map(r => r.column_name));
  }
  if (res.rows.find(r => r.table_name === 'SaasPlans')) {
     const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='SaasPlans'");
     console.log("SaasPlans columns:", cols.rows.map(r => r.column_name));
     const rows = await client.query("SELECT * FROM \"SaasPlans\"");
     console.log("SaasPlans data:", rows.rows);
  }
  if (res.rows.find(r => r.table_name === 'Licenses')) {
     const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='Licenses'");
     console.log("Licenses columns:", cols.rows.map(r => r.column_name));
     const rows = await client.query("SELECT * FROM \"Licenses\" LIMIT 1");
     console.log("Licenses data:", rows.rows);
  }

  process.exit(0);
}
check();

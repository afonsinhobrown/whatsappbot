import pg from 'pg';
const { Client } = pg;

const url = "postgresql://neondb_owner:npg_CS1wih7QaNAu@ep-silent-moon-apyitvv5-pooler.c-7.us-east-1.aws.neon.tech/armazem?sslmode=require";

async function check() {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    
    // Check tables to see structure first
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("Tables:", res.rows.map(r => r.table_name).join(", "));
    
    const resUser = await client.query("SELECT * FROM users WHERE email = 'ffmondlane@moztelesolucoes.co.mz' OR email ILIKE '%ffmondlane%'");
    console.log("User ffmondlane:", resUser.rows);

  } catch (e) {
    console.error(e.message);
  } finally {
    await client.end();
  }
}
check();

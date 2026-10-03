import dotenv from "dotenv";
import pg from "pg";
for (const p of [".env.local", ".env"]) { try { dotenv.config({ path: p }); } catch {} }
const pool = new pg.Pool({ connectionString: process.env.GESTORFARMA_SUPABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });

const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='farmacias_licenca' ORDER BY ordinal_position`);
console.log("farmacias_licenca colunas:", cols.rows.map((c) => c.column_name).join(", "));

const lic = await pool.query(`SELECT * FROM farmacias_licenca ORDER BY id`);
console.log("\n=== " + lic.rows.length + " licencas ===");
for (const r of lic.rows) console.log("  " + JSON.stringify(r));

const pg1 = await pool.query(`SELECT * FROM farmacias_planofarmacia ORDER BY id`);
console.log("\n=== " + pg1.rows.length + " planos ===");
for (const r of pg1.rows) console.log("  " + JSON.stringify(r).slice(0, 160));

// alguma tabela do bot (licencas/pagamentos/planos/produtos/tenants) na base do GestorFarma?
const bot = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('licencas','pagamentos','planos','produtos','tenants','clientes','bot_sessoes','cotacoes')`);
console.log("\ntabelas do bot encontradas na base do GestorFarma: " + (bot.rows.length ? bot.rows.map((b) => b.table_name).join(", ") : "NENHUMA"));

const mig = await pool.query(`SELECT app, name, applied FROM django_migrations ORDER BY id DESC LIMIT 5`);
console.log("\nultimas migrations django aplicadas: " + mig.rows.map((m) => m.app + "." + m.name).join(" | "));
await pool.end();
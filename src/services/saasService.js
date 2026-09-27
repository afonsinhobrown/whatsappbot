import pg from "pg";
const { Pool } = pg;

const xonguilePool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_nip0JfTVxD7a@ep-steep-haze-at2hj23v-pooler.c-9.us-east-1.aws.neon.tech/xonguile-neon?sslmode=require&channel_binding=require",
});

export async function validarXonguile(username, password) {
  try {
    const res = await xonguilePool.query(
      'SELECT id, name, email FROM "Users" WHERE email = $1 AND password = $2',
      [username, password]
    );
    if (res.rows.length > 0) {
      return { valid: true, user: res.rows[0] };
    }
    return { valid: false };
  } catch (err) {
    console.error("Erro na BD do Xonguile:", err);
    return { valid: false, error: err.message };
  }
}

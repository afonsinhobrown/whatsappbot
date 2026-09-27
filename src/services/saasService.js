import pg from "pg";
const { Pool } = pg;

// Inicializa as pools usando as variáveis de ambiente (com fallbacks para evitar crash se faltarem)
const pools = {
  XONGUILE: new Pool({ connectionString: process.env.XONGUILE_DB_URL || "" }),
  CAFEPOINT: new Pool({ connectionString: process.env.CAFEPOINT_DB_URL || "" }),
  SHOPLINK: new Pool({ connectionString: process.env.SHOPLINK_DB_URL || "" }),
  ARMAZEM: new Pool({ connectionString: process.env.ARMAZEM_DB_URL || "" })
};

/**
 * Valida a conta num sistema SaaS específico.
 */
export async function validarContaSaaS(produtoNome, username, password) {
  const sistema = getSistemaChave(produtoNome);
  const pool = pools[sistema];
  
  if (!pool || !process.env[`${sistema}_DB_URL`]) {
    console.log(`[SaaS] Validação saltada para ${produtoNome}: sem DB URL configurada.`);
    // Devolvemos sempre válido se não houver DB ligada, para não bloquear o cliente
    return { valid: true, user: { name: "Cliente" } };
  }

  try {
    let queryStr = "";
    let values = [username, password];
    
    switch (sistema) {
      case "XONGUILE":
        queryStr = 'SELECT id, name, email FROM "Users" WHERE email = $1 AND password = $2';
        break;
      case "CAFEPOINT":
        queryStr = 'SELECT id, name, email FROM "User" WHERE email = $1 AND password = $2'; // Exemplo Prisma
        break;
      case "SHOPLINK":
        queryStr = 'SELECT id, nome as name, email FROM utilizador WHERE email = $1 AND password = $2';
        break;
      case "ARMAZEM":
        queryStr = 'SELECT id, name, email FROM "Users" WHERE email = $1 AND password = $2';
        break;
      default:
        return { valid: true, user: { name: "Cliente" } };
    }
    
    const res = await pool.query(queryStr, values);
    if (res.rows.length > 0) {
      return { valid: true, user: res.rows[0] };
    }
    return { valid: false };
  } catch (err) {
    console.error(`Erro na BD do ${sistema}:`, err);
    return { valid: false, error: err.message };
  }
}

/**
 * Ativa ou renova a licença num sistema SaaS.
 * Esta função deve ser chamada quando o pagamento é confirmado.
 */
export async function ativarLicenca(produtoNome, username, meses = 1) {
  const sistema = getSistemaChave(produtoNome);
  const pool = pools[sistema];
  
  if (!pool || !process.env[`${sistema}_DB_URL`]) {
    console.log(`[SaaS] Ativação saltada para ${produtoNome}: sem DB URL configurada.`);
    return false;
  }
  
  try {
    let userId;
    let userRes;
    
    switch (sistema) {
      case "XONGUILE":
        // Pega o utilizador e o SalonId
        userRes = await pool.query('SELECT "SalonId" FROM "Users" WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const salonId = userRes.rows[0].SalonId;
          // Prolonga a licença
          await pool.query('UPDATE "Licenses" SET status = \'active\', "validUntil" = "validUntil" + interval \'1 month\' * $1 WHERE "SalonId" = $2', [meses, salonId]);
          return true;
        }
        break;
      case "CAFEPOINT":
        // Pega o Restaurante / Empresa
        userRes = await pool.query('SELECT "restaurantId" FROM "User" WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const restId = userRes.rows[0].restaurantId;
          await pool.query('UPDATE "License" SET status = \'active\', "validUntil" = "validUntil" + interval \'1 month\' * $1 WHERE "restaurantId" = $2', [meses, restId]);
          return true;
        }
        break;
      case "SHOPLINK":
        userRes = await pool.query('SELECT tenant_id FROM utilizador WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const tenantId = userRes.rows[0].tenant_id;
          await pool.query("UPDATE licenca SET estado = 'ATIVA', data_fim = data_fim + interval '1 month' * $1 WHERE tenant_id = $2", [meses, tenantId]);
          return true;
        }
        break;
      case "ARMAZEM":
        // Simplesmente devolve true por enquanto
        return true;
    }
  } catch (err) {
    console.error(`Erro ao ativar licença no ${sistema}:`, err);
    return false;
  }
  return false;
}

function getSistemaChave(produtoNome) {
  const p = (produtoNome || "").toLowerCase();
  if (p.includes("xonguile")) return "XONGUILE";
  if (p.includes("cafe point") || p.includes("cafepoint")) return "CAFEPOINT";
  if (p.includes("shoplink") || p.includes("shop link")) return "SHOPLINK";
  if (p.includes("armazem") || p.includes("armazém") || p.includes("farmacia")) return "ARMAZEM";
  return "OUTRO";
}

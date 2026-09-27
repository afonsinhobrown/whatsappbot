import pg from "pg";
const { Pool } = pg;

// Supabase (Principal) + Neon (Secundária)
const pools = {
  XONGUILE: {
    primary: new Pool({ connectionString: process.env.XONGUILE_SUPABASE_URL || "" }),
    secondary: new Pool({ connectionString: process.env.XONGUILE_NEON_URL || "" }),
  },
  GYMAR: {
    primary: new Pool({ connectionString: process.env.GYMAR_SUPABASE_URL || "" }),
    secondary: new Pool({ connectionString: process.env.GYMAR_NEON_URL || "" }),
  },
  GESTORFARMA: {
    primary: new Pool({ connectionString: process.env.GESTORFARMA_SUPABASE_URL || "" }),
    secondary: new Pool({ connectionString: process.env.GESTORFARMA_NEON_URL || "" }),
  },
  CAFEPOINT: {
    primary: new Pool({ connectionString: process.env.CAFEPOINT_DB_URL || "" })
  },
  SHOPLINK: {
    primary: new Pool({ connectionString: process.env.SHOPLINK_DB_URL || "" })
  },
  ARMAZEM: {
    primary: new Pool({ connectionString: process.env.ARMAZEM_DB_URL || "" })
  }
};

/**
 * Executa uma query em ambas as bases de dados (se a secundária existir).
 */
async function queryDual(sistema, queryStr, values) {
  const systemPools = pools[sistema];
  if (!systemPools) return { rows: [] };
  
  let primaryRes = { rows: [] };
  let secondaryRes = { rows: [] };

  try {
    if (systemPools.primary && process.env[`${sistema}_SUPABASE_URL`] || process.env[`${sistema}_DB_URL`]) {
      primaryRes = await systemPools.primary.query(queryStr, values);
    }
  } catch (err) {
    console.error(`Erro na BD Principal (${sistema}):`, err.message);
  }

  try {
    if (systemPools.secondary && process.env[`${sistema}_NEON_URL`]) {
      secondaryRes = await systemPools.secondary.query(queryStr, values);
    }
  } catch (err) {
    console.error(`Erro na BD Secundária/Neon (${sistema}):`, err.message);
  }

  // Devolver os resultados da principal (assumimos que a secundária é réplica)
  return primaryRes.rows.length > 0 ? primaryRes : secondaryRes;
}

/**
 * Valida a conta num sistema SaaS específico.
 */
export async function validarContaSaaS(produtoNome, username, password) {
  const sistema = getSistemaChave(produtoNome);
  
  try {
    let queryStr = "";
    let values = [];
    let isGymar = false;

    // Gymar (HefelGym) - Atleta insere nome ou código em vez de utilizador/senha
    if (sistema === "GYMAR") {
      isGymar = true;
      // Procura por nome ou ID e junta com o plano para descobrir o preço a pagar já com 16% IVA
      queryStr = 'SELECT c.id, c.name, (p.price * 1.16) as fee FROM clients c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.name ILIKE $1 OR c.id::text = $1';
      values = [username];
    } else {
      values = [username, password];
      switch (sistema) {
        case "XONGUILE":
          queryStr = 'SELECT id, name, email FROM "Users" WHERE email = $1 AND password = $2';
          break;
        case "GESTORFARMA":
          queryStr = 'SELECT id, name, email FROM "Users" WHERE email = $1 AND password = $2';
          break;
        case "CAFEPOINT":
          queryStr = 'SELECT id, name, email FROM "User" WHERE email = $1 AND password = $2';
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
    }
    
    const res = await queryDual(sistema, queryStr, values);
    if (res.rows.length > 0) {
      return { valid: true, user: res.rows[0], isGymar };
    }
    return { valid: false, isGymar };
  } catch (err) {
    console.error(`Erro na validação do ${sistema}:`, err);
    return { valid: false, error: err.message };
  }
}

/**
 * Ativa ou renova a licença/mensalidade num sistema SaaS (NAS DUAS BD SE APLICÁVEL).
 */
export async function ativarLicenca(produtoNome, username, meses = 1) {
  const sistema = getSistemaChave(produtoNome);
  
  try {
    let userRes;
    
    switch (sistema) {
      case "GYMAR":
        // Atualizar mensalidade do atleta na tabela clients (Gymar)
        userRes = await queryDual("GYMAR", 'SELECT id FROM clients WHERE name ILIKE $1 OR id::text = $1', [username]);
        if (userRes.rows.length > 0) {
          const atletaId = userRes.rows[0].id;
          await queryDual("GYMAR", "UPDATE clients SET status = 'ativo', end_date = GREATEST(end_date, CURRENT_TIMESTAMP) + interval '1 month' * $1 WHERE id = $2", [meses, atletaId]);
          return true;
        }
        break;

      case "XONGUILE":
        userRes = await queryDual("XONGUILE", 'SELECT "SalonId" FROM "Users" WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const salonId = userRes.rows[0].SalonId;
          await queryDual("XONGUILE", 'UPDATE "Licenses" SET status = \'active\', "validUntil" = GREATEST("validUntil", CURRENT_TIMESTAMP) + interval \'1 month\' * $1 WHERE "SalonId" = $2', [meses, salonId]);
          return true;
        }
        break;

      case "GESTORFARMA":
        userRes = await queryDual("GESTORFARMA", 'SELECT tenant_id FROM "Users" WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const tenantId = userRes.rows[0].tenant_id;
          await queryDual("GESTORFARMA", 'UPDATE "Licenses" SET status = \'active\', "validUntil" = GREATEST("validUntil", CURRENT_TIMESTAMP) + interval \'1 month\' * $1 WHERE "tenant_id" = $2', [meses, tenantId]);
          return true;
        }
        break;

      case "CAFEPOINT":
        userRes = await queryDual("CAFEPOINT", 'SELECT "restaurantId" FROM "User" WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const restId = userRes.rows[0].restaurantId;
          await queryDual("CAFEPOINT", 'UPDATE "License" SET status = \'active\', "validUntil" = GREATEST("validUntil", CURRENT_TIMESTAMP) + interval \'1 month\' * $1 WHERE "restaurantId" = $2', [meses, restId]);
          return true;
        }
        break;

      case "SHOPLINK":
        userRes = await queryDual("SHOPLINK", 'SELECT tenant_id FROM utilizador WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const tenantId = userRes.rows[0].tenant_id;
          await queryDual("SHOPLINK", "UPDATE licenca SET estado = 'ATIVA', data_fim = GREATEST(data_fim, CURRENT_TIMESTAMP) + interval '1 month' * $1 WHERE tenant_id = $2", [meses, tenantId]);
          return true;
        }
        break;

      case "ARMAZEM":
        return true;
    }
  } catch (err) {
    console.error(`Erro ao ativar licença no ${sistema}:`, err);
    return false;
  }
  return false;
}

export function getSistemaChave(produtoNome) {
  const p = (produtoNome || "").toLowerCase();
  if (p.includes("xonguile") || p.includes("salao")) return "XONGUILE";
  if (p.includes("gymar") || p.includes("hefelgym") || p.includes("ginasio")) return "GYMAR";
  if (p.includes("gestorfarma") || p.includes("farmacia")) return "GESTORFARMA";
  if (p.includes("cafe point") || p.includes("cafepoint")) return "CAFEPOINT";
  if (p.includes("shoplink") || p.includes("shop link")) return "SHOPLINK";
  if (p.includes("armazem") || p.includes("farmacia")) return "ARMAZEM";
  return "OUTRO";
}

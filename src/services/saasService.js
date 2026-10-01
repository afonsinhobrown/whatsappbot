import pg from "pg";
const { Pool } = pg;

// Quais variáveis de ambiente alimentam cada sistema.
const FONTES = {
  XONGUILE: { primary: "XONGUILE_SUPABASE_URL", secondary: "XONGUILE_NEON_URL" },
  GYMAR: { primary: "GYMAR_SUPABASE_URL", secondary: "GYMAR_NEON_URL" },
  GESTORFARMA: { primary: "GESTORFARMA_SUPABASE_URL", secondary: "GESTORFARMA_NEON_URL" },
  CAFEPOINT: { primary: "CAFEPOINT_DB_URL" },
  SHOPLINK: { primary: "SHOPLINK_DB_URL" },
  ARMAZEM: { primary: "ARMAZEM_DB_URL" },
};

// Pools criados à primeira utilização, não ao carregar o módulo.
// Ao carregar o módulo as variáveis de ambiente ainda podiam não estar
// definidas (os imports do ESM são executados todos antes do código que
// chama dotenv), e o Pool ficava com connectionString vazia — a partir
// daí nenhuma consulta ao sistema do cliente funcionava.
const pools = {};

function poolDe(sistema, tipo) {
  const chave = `${sistema}:${tipo}`;
  if (pools[chave]) return pools[chave];
  const url = process.env[FONTES[sistema][tipo]] || "";
  if (!url) return null;
  pools[chave] = new Pool({ connectionString: url });
  return pools[chave];
}

/** true quando o sistema tem credenciais configuradas neste processo. */
export function conectorConfigurado(sistema) {
  const fontes = FONTES[sistema];
  if (!fontes) return false;
  return Boolean(process.env[fontes.primary]);
}

/**
 * Executa uma query em ambas as bases de dados (se a secundária existir).
 */
async function queryDual(sistema, queryStr, values) {
  if (!FONTES[sistema]) return { rows: [] };

  let primaryRes = { rows: [] };
  let secondaryRes = { rows: [] };

  const primary = poolDe(sistema, "primary");
  if (primary) {
    try {
      primaryRes = await primary.query(queryStr, values);
    } catch (err) {
      console.error(`Erro na BD Principal (${sistema}):`, err.message);
    }
  }

  const secondary = poolDe(sistema, "secondary");
  if (secondary) {
    try {
      secondaryRes = await secondary.query(queryStr, values);
    } catch (err) {
      console.error(`Erro na BD Secundária/Neon (${sistema}):`, err.message);
    }
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
      queryStr = 'SELECT c.id, c.name, (p.price::numeric * 1.16) as fee FROM clients c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.name ILIKE $1 OR c.id::text = $1';
      values = [username];
    } else {
      values = [username, password];
      switch (sistema) {
        case "XONGUILE":
          queryStr = 'SELECT id, name, email FROM "Users" WHERE email = $1';
          values = [username];
          break;
        case "GESTORFARMA":
          queryStr = 'SELECT id, nome as name, email FROM farmacias_farmacia WHERE email = $1';
          values = [username];
          break;
        case "CAFEPOINT":
          queryStr = 'SELECT id, name, username as email FROM "User" WHERE username = $1';
          values = [username];
          break;
        case "SHOPLINK":
          queryStr = 'SELECT id, nome as name, email FROM utilizador WHERE email = $1';
          values = [username];
          break;
        case "ARMAZEM":
          queryStr = 'SELECT id, company_name as name, email, plan FROM users WHERE email = $1';
          values = [username];
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
 *
 * `slugPlano` é o slug do plano no sistema do cliente. Sem ele a renovação
 * mantém o plano actual — o que serve para renovar, mas não para mudar de
 * plano depois de o cliente escolher outro no bot.
 *
 * `valorPago` é o que o cliente pagou. Só o GestorFarma o usa: as licenças
 * dessa casa não guardam o plano, e sem registar plano nem valor a renovação
 * seguinte volta a não saber o que a farmácia tem contratado.
 */
export async function ativarLicenca(produtoNome, username, meses = 1, slugPlano = null, valorPago = null) {
  const sistema = getSistemaChave(produtoNome);
  
  try {
    let userRes;
    
    switch (sistema) {
      case "GYMAR":
        // Atualizar mensalidade do atleta na tabela clients (Gymar)
        userRes = await queryDual("GYMAR", "SELECT id FROM clients WHERE name ILIKE $1 OR id::text = $1", [username]);
        if (userRes.rows.length > 0) {
          const atletaId = userRes.rows[0].id;
          // 'active' e não 'ativo': é o valor que a base do Gymar usa em todos
          // os clientes. Com 'ativo' o atleta pagava, o status ficava com um
          // valor que a leitura nunca reconhecia, e voltava a aparecer expirado.
          // end_date é NULL em toda a base, por isso o GREATEST ficava NULL e
          // a validade continuava a não aparecer: passa a contar de hoje.
          const res = await queryDual(
            "GYMAR",
            "UPDATE clients SET status = 'active', " +
              "end_date = COALESCE(end_date, CURRENT_DATE) + interval '1 month' * $1 " +
              "WHERE id = $2",
            [meses, atletaId]
          );
          if (res.rowCount === 0) {
            console.error(`[SAAS] Gymar: o atleta ${atletaId} (${username}) não foi actualizado`);
            return false;
          }
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
        userRes = await queryDual("GESTORFARMA", "SELECT id FROM farmacias_farmacia WHERE email = $1", [username]);
        if (userRes.rows.length > 0) {
          const farmId = userRes.rows[0].id;
          const res = await queryDual(
            "GESTORFARMA",
            "UPDATE farmacias_licenca " +
              "SET is_ativa = true, paga = true, plano_id = COALESCE($3, plano_id), " +
              "valor_pago = COALESCE($4, valor_pago), " +
              "data_fim = GREATEST(data_fim, CURRENT_TIMESTAMP) + interval '1 month' * $1 " +
              "WHERE id = (SELECT id FROM farmacias_licenca WHERE farmacia_id = $2 " +
              "ORDER BY data_inicio DESC NULLS LAST LIMIT 1)",
            [meses, farmId, slugPlano ? Number(slugPlano) || null : null, valorPago]
          );
          if (res.rowCount === 0) {
            console.error(
              `[SAAS] GestorFarma: a farmácia ${farmId} não tem licença para renovar ` +
                `(cliente ${username}, plano ${slugPlano}, ${valorPago} MZN)`
            );
            return false;
          }
          return true;
        }
        break;

      case "CAFEPOINT":
        // A licença é do Restaurant, não do User — e a coluna é "endDate"
        // (não "validUntil"). Com "validUntil" o UPDATE rebentava e o
        // Cafe Point nunca era activado.
        userRes = await queryDual("CAFEPOINT", 'SELECT "restaurantId" FROM "User" WHERE username = $1', [username]);
        if (userRes.rows.length === 0) {
          userRes = await queryDual("CAFEPOINT", 'SELECT id AS "restaurantId" FROM "Restaurant" WHERE email = $1', [username]);
        }
        if (userRes.rows.length > 0) {
          const restId = userRes.rows[0].restaurantId;
          await queryDual("CAFEPOINT", "UPDATE \"License\" SET status = 'active', \"endDate\" = GREATEST(\"endDate\", CURRENT_TIMESTAMP) + interval '1 month' * $1 WHERE \"restaurantId\" = $2", [meses, restId]);
          return true;
        }
        break;

      case "SHOPLINK":
        // A licença é por LOJA, não por tenant: utilizador -> utilizador_loja
        // -> licenca. O UPDATE antigo filtrava por "tenant_id", coluna que
        // a tabela licenca não tem — falhava sempre.
        userRes = await queryDual("SHOPLINK", 'SELECT id FROM utilizador WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const utilizadorId = userRes.rows[0].id;
          await queryDual("SHOPLINK", "UPDATE licenca SET estado = 'ativa', data_fim = GREATEST(data_fim, CURRENT_TIMESTAMP) + interval '1 month' * $1 WHERE loja_id IN (SELECT loja_id FROM utilizador_loja WHERE utilizador_id = $2)", [meses, utilizadorId]);
          return true;
        }
        break;

      case "ARMAZEM":
        userRes = await queryDual("ARMAZEM", 'SELECT id FROM users WHERE email = $1', [username]);
        if (userRes.rows.length > 0) {
          const uId = userRes.rows[0].id;
          // Confirma o slug antes de gravar: escrever um slug inexistente
          // deixaria a conta sem plano nenhum.
          if (slugPlano) {
            const existe = await queryDual("ARMAZEM", "SELECT 1 FROM plans WHERE slug = $1 AND is_active = true", [slugPlano]);
            if (existe.rows.length > 0) {
              await queryDual("ARMAZEM", "UPDATE users SET plan = $1 WHERE id = $2", [slugPlano, uId]);
            } else {
              console.warn(`[SAAS] slug de plano "${slugPlano}" não existe no Armazém — mantendo o plano actual`);
            }
          }
          await queryDual("ARMAZEM", "UPDATE users SET trial_ends_at = GREATEST(trial_ends_at, CURRENT_TIMESTAMP) + interval '1 month' * $1 WHERE id = $2", [meses, uId]);
          return true;
        }
        break;
    }
  } catch (err) {
    console.error(`Erro ao ativar licença no ${sistema}:`, err);
    return false;
  }
  return false;
}

export function getSistemaChave(produtoNome) {
  // Sem acentos: "Café Point" e "Armazém" têm de bater nos mesmos testes.
  const p = (produtoNome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (p.includes("xonguile") || p.includes("salao")) return "XONGUILE";
  if (p.includes("gymar") || p.includes("hefelgym") || p.includes("ginasio")) return "GYMAR";
  if (p.includes("cafe point") || p.includes("cafepoint")) return "CAFEPOINT";
  if (p.includes("shoplink") || p.includes("shop link")) return "SHOPLINK";
  // Smart Warehouse WMS é o Armazém. Sem esta linha o produto caía em
  // "OUTRO": a conta nunca era lida e a licença nunca era activada lá
  // dentro, mesmo com o pagamento confirmado.
  if (
    p.includes("smart warehouse") ||
    p.includes("smartwms") ||
    p.includes("wms") ||
    p.includes("armazem") ||
    p.includes("moz tele") ||
    p.includes("armazem")
  ) {
    return "ARMAZEM";
  }
  if (p.includes("gestorfarma") || p.includes("farmacia")) return "GESTORFARMA";
  return "OUTRO";
}

/** Nome a mostrar ao cliente para cada sistema com conector. */
export const SISTEMA_LABEL = {
  ARMAZEM: "Smart Warehouse (Armazém)",
  XONGUILE: "Xonguile",
  GYMAR: "Gymar",
  GESTORFARMA: "GestorFarma",
  CAFEPOINT: "Cafe Point",
  SHOPLINK: "Shoplink",
};

export function temConector(produtoNome) {
  return SISTEMA_LABEL[getSistemaChave(produtoNome)] !== undefined;
}

/**
 * Query directa a uma BD de sistema, devolvendo também o erro.
 * `queryDual` engole as excepções, e aqui precisamos de distinguir
 * "não existe licença" de "a query está errada" para não inventar dados.
 */
async function consultar(sistema, queryStr, values) {
  const fontes = FONTES[sistema];
  if (!fontes) return { rows: [], erro: "sem conector" };

  // Cada sistema tem mais do que uma connection string. Se a primeira não
  // responder (URL errada, DNS, firewall), tentamos a segunda antes de
  // dizer ao cliente que não conseguimos ler a licença. Sem isto, uma
  // connection string partida tirava o sistema inteiro do ar.
  let respondeu = false;
  let ultimoErro = null;

  for (const tipo of ["primary", "secondary"]) {
    if (!fontes[tipo]) continue;
    const pool = poolDe(sistema, tipo);
    if (!pool) continue;
    try {
      const r = await pool.query(queryStr, values);
      respondeu = true;
      if (r.rows.length) return { rows: r.rows, erro: null };
      // Respondeu sem linhas: a conta não está nesta base. Se houver outra,
      // continuamos à procura antes de dizer "não encontrei".
    } catch (err) {
      console.error(`[SAAS] ${fontes[tipo]} (${tipo}) falhou:`, err.message);
      ultimoErro = err.message;
    }
  }

  // Distinção importante: respondeu-sem-resultados = conta não encontrada;
  // nenhuma fonte respondeu = avaria de ligação.
  if (respondeu) return { rows: [], erro: null };
  return { rows: [], erro: ultimoErro || "conector sem credenciais" };
}

/** Queries que devolvem a conta. Já eram usadas em produção — não breaking. */
const CONSULTA_CONTA = {
  ARMAZEM: {
    sql: "SELECT id, company_name AS name, email, plan FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
    chave: "email",
  },
  XONGUILE: {
    sql: 'SELECT id, name, email, "SalonId" FROM "Users" WHERE LOWER(email) = LOWER($1) LIMIT 1',
    chave: "email",
  },
  GYMAR: {
    sql: "SELECT c.id, c.name, p.price::numeric * 1.16 AS fee, p.name AS plano_nome " +
      "FROM clients c LEFT JOIN plans p ON p.id = c.plan_id " +
      "WHERE c.name ILIKE $1 OR c.id::text = $1 LIMIT 1",
    chave: "nome ou id",
  },
  GESTORFARMA: {
    sql: "SELECT f.id, f.nome AS name, f.email FROM farmacias_farmacia f WHERE LOWER(f.email) = LOWER($1) " +
      "UNION ALL " +
      "SELECT f.id, f.nome AS name, u.email FROM farmacias_farmacia f JOIN accounts_user u ON u.id = f.usuario_id " +
      "WHERE LOWER(u.email) = LOWER($1) LIMIT 1",
    chave: "email",
  },
  CAFEPOINT: {
    sql: 'SELECT r.id, r.name, NULL::text AS username, r.id AS "restaurantId" ' +
      'FROM "Restaurant" r WHERE LOWER(r.email) = LOWER($1) ' +
      "UNION ALL " +
      'SELECT u.id, u.name, u.username, u."restaurantId" ' +
      'FROM "User" u WHERE LOWER(u.username) = LOWER($1) LIMIT 1',
    chave: "email",
  },
  SHOPLINK: {
    sql: "SELECT id, nome AS name, email, tenant_id FROM utilizador WHERE LOWER(email) = LOWER($1) LIMIT 1",
    chave: "email",
  },
};

/** Queries que devolvem plano e validade. Todas opcionais. */
const CONSULTA_LICENCA = {
  ARMAZEM: async (conta) => {
    const { rows } = await consultar(
      "ARMAZEM",
      "SELECT u.trial_ends_at, p.name AS plano_nome, p.monthly_price, p.duration_days " +
        "FROM users u LEFT JOIN plans p ON p.slug = u.plan WHERE u.id = $1",
      [conta.id]
    );
    return rows[0] || {};
  },
  XONGUILE: async (conta) => {
    const { rows } = await consultar(
      "XONGUILE",
// O type da licença vem como "premium_month"/"basic_year", mas o código
      // do plano é "premium"/"basic" — daí o corte do sufixo de periodicidade.
      // A coluna é um enum, por isso precisa de ::text para se poder expressar
      // em regex.
      'SELECT l.status, l."validUntil", l.type::text AS type, p.name AS plano_nome, p.price AS monthly_price ' +
        'FROM "Licenses" l LEFT JOIN "SaasPlans" p ' +
        "ON p.code = regexp_replace(l.type::text, '_(month|year|annual|monthly|yearly)$', '') " +
        'WHERE l."SalonId" = $1 ORDER BY l."createdAt" DESC LIMIT 1',
      [conta.SalonId]
    );
    return rows[0] || {};
  },
  GYMAR: async (conta) => {
    // O Gymar não preenche end_date: é NULL em todos os clientes. O que diz se
    // a mensalidade está a correr é o status (active/inactive) e o plano vem da
    // coluna plan_name do próprio cliente — o join a plans só por plan_id
    // deixava o plano a null sempre que esse campo não estava preenchido.
    const { rows } = await consultar(
      "GYMAR",
      "SELECT c.status, c.end_date, c.start_date, c.last_payment, " +
        "COALESCE(p.name, c.plan_name) AS plano_nome, " +
        "p.price::numeric * 1.16 AS monthly_price, " +
        "c.plan_name, p.id AS plano_id " +
        "FROM clients c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = $1",
      [conta.id]
    );
    return rows[0] || {};
  },
  GESTORFARMA: async (conta) => {
    const { rows } = await consultar(
      "GESTORFARMA",
      "SELECT l.is_ativa, l.data_inicio, l.data_fim, l.valor_pago, l.tipo, " +
        "pl.nome AS plano_nome, pl.preco_mensal AS monthly_price " +
        "FROM farmacias_licenca l LEFT JOIN farmacias_planofarmacia pl ON pl.id = l.plano_id " +
        "WHERE l.farmacia_id = $1 ORDER BY l.data_inicio DESC NULLS LAST LIMIT 1",
      [conta.id]
    );
    return rows[0] || {};
  },
  CAFEPOINT: async (conta) => {
    const { rows } = await consultar(
      "CAFEPOINT",
      'SELECT l.status, l."startDate", l."endDate", pl.name AS plano_nome, pl."monthlyPrice" AS monthly_price, pl.duration AS duration_days ' +
        'FROM "License" l LEFT JOIN "Plan" pl ON pl.id = l."planId" WHERE l."restaurantId" = $1 LIMIT 1',
      [conta.restaurantId]
    );
    return rows[0] || {};
  },
  SHOPLINK: async (conta) => {
    const { rows } = await consultar(
      "SHOPLINK",
      "SELECT l.estado, l.plano, l.data_inicio, l.data_fim, l.valor_mensal AS monthly_price " +
        "FROM licenca l JOIN utilizador_loja ul ON ul.loja_id = l.loja_id " +
        "WHERE ul.utilizador_id = $1 ORDER BY l.data_fim DESC NULLS LAST LIMIT 1",
      [conta.id]
    );
    return rows[0] || {};
  },
};

/**
 * Lê a licença REAL da conta no sistema do cliente: que plano usa e até
 * quando. É isto que o cliente quer ver antes de pagar.
 *
 * Nunca lança: devolve sempre um objecto com `ok` para o fluxo poder
 * seguir em frente mesmo sem leitura automática.
 */
export async function consultarLicencaSaaS(produtoNome, identificador) {
  const sistema = getSistemaChave(produtoNome);
  const cfg = CONSULTA_CONTA[sistema];

  if (!cfg) {
    return { ok: false, sistema, semConector: true, motivo: "sem conector" };
  }

  const conta = await consultar(sistema, cfg.sql, [identificador]);
  if (conta.erro && conta.erro !== "sem conector") {
    return { ok: false, sistema, erro: conta.erro };
  }
  if (!conta.rows.length) {
    return { ok: false, sistema, contaNaoEncontrada: true, campo: cfg.chave };
  }

  const u = conta.rows[0];
  let lic = {};
  try {
    lic = await CONSULTA_LICENCA[sistema](u);
  } catch (err) {
    console.error(`[SAAS] leitura de licença em ${sistema} falhou:`, err.message);
  }

  // "Plano Controlo Interno" vem de plans.name; para quem só tem o slug
  // (ex. "interno") mostramos o slug prettificado em vez de nada.
  // Cada sistema nomeou as colunas à sua maneira: "plano" no Shoplink,
  // "plano_nome" ligado à tabela de planos nos restantes.
  const planoBruto = lic.plano_nome || lic.plano || u.plan || null;
  let plano = planoBruto
    ? planoBruto.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : null;

  // No GestorFarma as licenças não guardam qual o plano (plano_id fica NULL),
  // mas o valor pago identifica-o: 2223 é o Pacote Especial NHAMAINGA. Sem
  // esta leitura o cliente pagador via a lista de planos em vez de lhe
  // renovarmos o plano que já tem.
  let planoPorPreco = null;
  const valorPago = lic.valor_pago === null || lic.valor_pago === undefined ? null : Number(lic.valor_pago);
  if (!plano && valorPago !== null && valorPago > 0) {
    planoPorPreco = await planoPeloValorPago(produtoNome, valorPago);
    if (planoPorPreco) plano = planoPorPreco.nome;
  }

  const validade =
    lic.validUntil || lic.endDate || lic.data_fim || lic.trial_ends_at || u.trial_ends_at || null;
  const estadoBruto = lic.status || lic.estado || null;
  let estado =
    estadoBruto !== null && estadoBruto !== undefined
      ? String(estadoBruto).toLowerCase()
      : typeof lic.is_ativa === "boolean"
        ? lic.is_ativa
          ? "active"
          : "inactive"
        : null;
  // Gymar usa "inactive" para quem não está activo (expirado/cancelado)
  if (estado === "inactive" && sistema === "GYMAR") estado = "expired";

  // No Gymar o preço é o plano do atleta + 16% de IVA, lido da própria base
  // de dados. Nos outros sistemas o preço vem do catálogo de planos.
  // O Shoplink devolve "valor_mensal" como texto — Number evita que a
  // comparação com o catálogo (numérica) falhe e o preço caia para o genérico.
  const precoBruto = u.fee ?? lic.monthly_price ?? planoPorPreco?.preco ?? null;
  const preco = precoBruto === null || precoBruto === undefined ? null : Number(precoBruto);

  let dias = null;
  if (validade) {
    const d = Math.ceil((new Date(validade) - new Date()) / 86400000);
    if (!Number.isNaN(d)) dias = d;
  }

  // Licença expirada é expirada, mesmo que a flag is_ativa ainda diga que
  // está activa. No GestorFarma havia farmácias com is_ativa=true e data_fim
  // já passada — o bot dizia ao cliente que a licença estava activa. Numa bot
  // que vende renovações, esse é o erro mais caro que há.
  //
  // Quando o sistema não tem data de fim (o Gymar deixa end_date a NULL e só
  // marca active/inactive), o status é o que decide: sem esta parte o cliente
  // via "válido até —" e nunca soube se o plano estava a correr.
  const expirada = dias !== null ? dias < 0 : estado === "expired";

  return {
    ok: true,
    sistema,
    id: u.id,
    nome: u.name || u.company_name || identificador,
    identificador,
    plano,
    planoSlug: planoPorPreco ? planoPorPreco.slug : u.plan || lic.plan_name || null,
    validade: validade ? new Date(validade).toISOString() : null,
    dias,
    estado: expirada ? "expired" : estado,
    expirada,
    precoSugerido: preco,
    duracaoDias: lic.duration_days ?? null,
  };
}

/**
 * Descobre o plano a que um valor pago corresponde.
 *
 * Só para sistemas cujas licenças não guardam o plano: o GestorFarma tem
 * `valor_pago` na licença e a tabela de planos com os preços, por isso o
 * valor pago é o que diz o que a farmácia contratou. Se nenhum plano tiver
 * esse preço (o plano mudou de valor desde a compra), devolvemos null e o
 * cliente vê a lista — adivinhar seria cobrar o valor errado.
 */
async function planoPeloValorPago(produtoNome, valor) {
  const { ok, planos } = await listarPlanosSaaS(produtoNome);
  if (!ok || !planos.length) return null;
  return planos.find((p) => Math.abs(Number(p.preco) - valor) < 0.01) || null;
}

/* =========================================================================
 * PLANOS REAIS DE CADA SISTEMA
 *
 * O catálogo do bot (tabela `planos`) é um modelo genérico — o mesmo
 * Basic/Premium/Enterprise colado a todos os sistemas — e os preços não
 * batem com nada do que está nas bases de dados dos clientes. Cobrar do
 * catálogo era cobrar um número inventado.
 *
 * Cada sistema tem a sua tabela de planos, com o preço e o slug verdadeiros.
 * É daí que passam a vir os planos, o preço e o plano que é gravado na conta
 * depois do pagamento.
 * ========================================================================= */

/** Queries que devolvem os planos que o sistema realmente vende. */
const CONSULTA_PLANOS = {
  ARMAZEM: async () => {
    const { rows } = await consultar(
      "ARMAZEM",
      "SELECT slug, name AS nome, monthly_price AS preco, duration_days, description, is_public " +
        "FROM plans WHERE is_active = true ORDER BY monthly_price"
    );
    return rows;
  },
  XONGUILE: async () => {
    const { rows } = await consultar(
      "XONGUILE",
      'SELECT code AS slug, name AS nome, price AS preco, period, features FROM "SaasPlans" ' +
        'WHERE "is_active" = true ORDER BY price'
    );
    return rows.map((r) => ({ ...r, duracaoDias: 30 }));
  },
  // No Gymar o preço ao cliente final leva 16% de IVA.
  GYMAR: async () => {
    const { rows } = await consultar(
      "GYMAR",
      "SELECT id AS slug, name AS nome, (price::numeric * 1.16)::float AS preco, duration, features " +
        "FROM plans ORDER BY price::numeric"
    );
    return rows.map((r) => ({ ...r, duracaoDias: r.duration || 30 }));
  },
  CAFEPOINT: async () => {
    const { rows } = await consultar(
      "CAFEPOINT",
      'SELECT id::text AS slug, name AS nome, "monthlyPrice" AS preco, duration AS duracaoDias FROM "Plan" ' +
        'WHERE "isActive" = true ORDER BY "monthlyPrice"'
    );
    return rows;
  },
  GESTORFARMA: async () => {
    const { rows } = await consultar(
      "GESTORFARMA",
      "SELECT id::text AS slug, nome, preco_mensal::float AS preco, recursos FROM farmacias_planofarmacia " +
        "WHERE is_ativo = true ORDER BY preco_mensal"
    );
    return rows.map((r) => ({ ...r, duracaoDias: 30, descricao: Array.isArray(r.recursos) ? r.recursos.join(", ") : null }));
  },
  // O Shoplink não tem tabela de planos: o preço vive na própria licença.
  SHOPLINK: async () => {
    const { rows } = await consultar(
      "SHOPLINK",
      "SELECT DISTINCT plano AS slug, plano AS nome, valor_mensal::float AS preco " +
        "FROM licenca WHERE plano IS NOT NULL ORDER BY preco"
    );
    return rows.map((r) => ({ ...r, duracaoDias: 30 }));
  },
};

/**
 * Planos que o sistema do cliente vende agora, lidos da base de dados dele.
 *
 * Devolve `{ ok:false, semConector:true }` quando não há base de dados
 * configurada — nesses casos o bot ainda tem de usar o catálogo.
 */
export async function listarPlanosSaaS(produtoNome) {
  const sistema = getSistemaChave(produtoNome);
  const consulta = CONSULTA_PLANOS[sistema];
  if (!consulta) return { ok: false, semConector: true, sistema };

  try {
    const planos = (await consulta()) || [];
    return {
      ok: true,
      sistema,
      planos: planos
        .map((p) => ({
          slug: p.slug,
          nome: p.nome,
          preco: p.preco === null || p.preco === undefined ? null : Number(p.preco),
          duracaoDias: p.duracaoDias ?? null,
          descricao: p.descricao || null,
          publico: p.is_public !== false,
        }))
        // Planos a 0 (trial) não se vendem: o cliente pagaria nada e
        // ficaria sem o que a activação é para.
        .filter((p) => p.slug && p.nome && Number(p.preco) > 0)
        // O Gymar tem o mesmo plano em duplicado (código antigo e o actual).
        // Mostrar as duas linhas ao cliente era confuso; fica a mais barata.
        .filter(
          (p, i, lista) => lista.findIndex((o) => o.nome === p.nome && Number(o.preco) === Number(p.preco)) === i
        ),
    };
  } catch (err) {
    console.error(`[SAAS] leitura de planos em ${sistema} falhou:`, err.message);
    return { ok: false, sistema, erro: err.message };
  }
}

/** Preço de um plano pelo slug, lido do sistema do cliente. */
export async function precoPlanoSaaS(produtoNome, slug) {
  const { ok, planos } = await listarPlanosSaaS(produtoNome);
  if (!ok) return null;
  const p = planos.find((x) => x.slug === slug);
  return p ? p.preco : null;
}

export const getPlanosSaaS = listarPlanosSaaS;
export const getPrecoPlanoSaaS = precoPlanoSaaS;
export const planosReaisDoSistema = listarPlanosSaaS;

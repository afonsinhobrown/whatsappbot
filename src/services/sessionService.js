import { query } from "./dbService.js";

/**
 * Devolve a sessão activa do cliente (a mais recente), criando uma nova
 * no estado "inicio" se ainda não existir.
 */
export async function getSession(tenantId, clienteId) {
  const found = await query(
    `SELECT * FROM bot_sessoes
      WHERE cliente_id = $1
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [clienteId]
  );
  if (found.rows[0]) return found.rows[0];

  const created = await query(
    `INSERT INTO bot_sessoes (tenant_id, cliente_id, estado_atual, contexto)
     VALUES ($1, $2, 'inicio', '{}'::jsonb)
     RETURNING *`,
    [tenantId, clienteId]
  );
  return created.rows[0];
}

/**
 * Actualiza o estado e o contexto da sessão activa do cliente.
 */
export async function setSession(clienteId, estado, contexto) {
  const updated = await query(
    `UPDATE bot_sessoes
        SET estado_atual = $2, contexto = $3::jsonb, updated_at = now()
      WHERE id = (
        SELECT id FROM bot_sessoes
         WHERE cliente_id = $1
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1)
      RETURNING *`,
    [clienteId, estado, JSON.stringify(contexto || {})]
  );
  if (updated.rows[0]) return updated.rows[0];

  return null;
}

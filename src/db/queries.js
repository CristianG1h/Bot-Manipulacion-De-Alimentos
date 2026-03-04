"use strict";

const { DATABASE_URL } = require("../config");
const { dbQuery } = require("./index");

async function getSession(wa_id) {
  if (!DATABASE_URL) return null;
  const r = await dbQuery(`SELECT * FROM sessions WHERE wa_id = $1`, [wa_id]);
  return r.rows[0] || null;
}

async function touchSessionInbound(wa_id) {
  if (!DATABASE_URL) return;
  await dbQuery(
    `UPDATE sessions SET last_inbound_at = NOW(), updated_at = NOW() WHERE wa_id = $1`,
    [wa_id]
  );
}

async function upsertSessionReset(wa_id) {
  if (!DATABASE_URL) return;

  await dbQuery(
    `
    INSERT INTO sessions (
      wa_id, step, temp_full_name, temp_cedula, temp_celular, temp_correo,
      updated_at, last_inbound_at, last_nudge_at, nudge_count
    )
    VALUES ($1, 'FULL_NAME', NULL, NULL, NULL, NULL, NOW(), NOW(), NULL, 0)
    ON CONFLICT (wa_id)
    DO UPDATE SET
      step = 'FULL_NAME',
      temp_full_name = NULL,
      temp_cedula = NULL,
      temp_celular = NULL,
      temp_correo = NULL,
      updated_at = NOW(),
      last_inbound_at = NOW(),
      last_nudge_at = NULL,
      nudge_count = 0;
    `,
    [wa_id]
  );
}

async function updateSession(wa_id, fields) {
  if (!DATABASE_URL) return;

  const allowed = ["temp_full_name", "temp_cedula", "temp_celular", "temp_correo", "step"];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return;

  const setParts = keys.map((k, i) => `${k} = $${i + 2}`);
  setParts.push(`updated_at = NOW()`);

  const values = [wa_id, ...keys.map((k) => fields[k])];

  await dbQuery(`UPDATE sessions SET ${setParts.join(", ")} WHERE wa_id = $1`, values);
}

async function deleteSession(wa_id) {
  if (!DATABASE_URL) return;
  await dbQuery(`DELETE FROM sessions WHERE wa_id = $1`, [wa_id]);
}

async function upsertRegistration(wa_id, full_name, cedula, celular, correo) {
  if (!DATABASE_URL) return;

  await dbQuery(
    `
    INSERT INTO registrations (wa_id, full_name, cedula, celular, correo, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (wa_id)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      cedula = EXCLUDED.cedula,
      celular = EXCLUDED.celular,
      correo = EXCLUDED.correo,
      updated_at = NOW();
    `,
    [wa_id, full_name, cedula, celular, correo]
  );
}

async function cedulaExistsForOtherWa(cedula, wa_id) {
  if (!DATABASE_URL) return false;
  const r = await dbQuery(`SELECT wa_id FROM registrations WHERE cedula = $1`, [cedula]);
  return r.rows.length > 0 && r.rows[0].wa_id !== wa_id;
}

async function isProcessedMessage(message_id) {
  if (!DATABASE_URL) return false;
  const r = await dbQuery(`SELECT 1 FROM processed_messages WHERE message_id = $1`, [message_id]);
  return r.rows.length > 0;
}

async function markMessageProcessed(message_id) {
  if (!DATABASE_URL) return;
  await dbQuery(
    `INSERT INTO processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING`,
    [message_id]
  );
}

async function cleanupProcessedMessages() {
  if (!DATABASE_URL) return;
  await dbQuery(`DELETE FROM processed_messages WHERE created_at < NOW() - INTERVAL '24 hours';`);
}

async function getPendingRegistrations(limit = 50) {
  if (!DATABASE_URL) return [];
  const safeLimit = Math.min(Number(limit) || 50, 200);

  const r = await dbQuery(
    `
    SELECT id, wa_id, full_name, cedula, celular, correo, created_at
    FROM registrations
    WHERE page_user_created = FALSE
    ORDER BY created_at ASC
    LIMIT $1
    `,
    [safeLimit]
  );

  return r.rows;
}

async function markRegistrationProcessed(id, page_user_id = null) {
  if (!DATABASE_URL) return null;

  const r = await dbQuery(
    `
    UPDATE registrations
    SET page_user_created = TRUE,
        page_user_created_at = NOW(),
        page_user_id = COALESCE($2, page_user_id),
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, page_user_created, page_user_created_at, page_user_id
    `,
    [id, page_user_id]
  );

  return r.rows[0] || null;
}

module.exports = {
  getSession,
  touchSessionInbound,
  upsertSessionReset,
  updateSession,
  deleteSession,
  upsertRegistration,
  cedulaExistsForOtherWa,
  isProcessedMessage,
  markMessageProcessed,
  cleanupProcessedMessages,
  getPendingRegistrations,
  markRegistrationProcessed,

};

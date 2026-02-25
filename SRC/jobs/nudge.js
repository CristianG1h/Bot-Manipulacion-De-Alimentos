"use strict";

const { DATABASE_URL, TOKEN, NUDGE_MAX, NUDGE_AFTER_MIN, SESSION_EXPIRE_MIN } = require("../config");
const { dbQuery } = require("../db");
const { sendPayload } = require("../services/whatsapp");

async function sendContinuePrompt(to) {
  const bodyText = "⏳ Notamos que no terminaste tu registro.\n\n¿Deseas continuar ahora?";

  return sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "continue_reg", title: "✅ Continuar" } },
          { type: "reply", reply: { id: "cancel_reg", title: "❌ Cancelar" } },
        ],
      },
    },
  });
}

async function nudgeAbandonedSessions() {
  if (!DATABASE_URL || !TOKEN) return;

  const r = await dbQuery(
    `
    SELECT wa_id, step, nudge_count, last_inbound_at, last_nudge_at
    FROM sessions
    WHERE
      nudge_count < $1
      AND last_inbound_at < NOW() - ($2 || ' minutes')::interval
      AND (last_nudge_at IS NULL OR last_nudge_at < NOW() - ($2 || ' minutes')::interval)
  `,
    [NUDGE_MAX, String(NUDGE_AFTER_MIN)]
  );

  for (const s of r.rows) {
    await sendContinuePrompt(s.wa_id);
    await dbQuery(
      `UPDATE sessions SET nudge_count = nudge_count + 1, last_nudge_at = NOW() WHERE wa_id = $1`,
      [s.wa_id]
    );
  }

  await dbQuery(
    `DELETE FROM sessions WHERE last_inbound_at < NOW() - ($1 || ' minutes')::interval`,
    [String(SESSION_EXPIRE_MIN)]
  );
}

module.exports = { nudgeAbandonedSessions };
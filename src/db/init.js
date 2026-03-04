"use strict";

const { DATABASE_URL } = require("../config");
const { dbQuery } = require("./index");

async function initDb() {
  if (!DATABASE_URL) return;

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      wa_id TEXT NOT NULL UNIQUE,
      full_name TEXT,
      cedula TEXT,
      celular TEXT,
      correo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbQuery(`CREATE UNIQUE INDEX IF NOT EXISTS ux_registrations_cedula ON registrations (cedula);`);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS sessions (
      wa_id TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      temp_full_name TEXT,
      temp_cedula TEXT,
      temp_celular TEXT,
      temp_correo TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  
await dbQuery(`
  ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS page_user_created BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS page_user_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS page_user_id TEXT;
`);
  
  await dbQuery(`
    ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS nudge_count INT NOT NULL DEFAULT 0;
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_processed_messages_created_at
    ON processed_messages (created_at);
  `);

  console.log("✅ PostgreSQL listo (tablas verificadas/creadas).");
}


module.exports = { initDb };

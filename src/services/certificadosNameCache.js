"use strict";

const { Pool } = require("pg");

let pool = null;
let initPromise = null;
let warnedMissingConfig = false;
let loggedHost = false;

function getPool() {
  const connectionString = String(
    process.env.CERTIFICADOS_DATABASE_URL || ""
  ).trim();

  if (!connectionString) {
    if (!warnedMissingConfig) {
      console.warn(
        "⚠️ CERTIFICADOS_DATABASE_URL no configurado. Caché persistente de nombres desactivada."
      );
      warnedMissingConfig = true;
    }
    return null;
  }

  if (!loggedHost) {
    try {
      console.log(
        "🔎 CERTIFICADOS_DATABASE_URL host:",
        new URL(connectionString).hostname
      );
    } catch {
      console.log("❌ CERTIFICADOS_DATABASE_URL inválida");
    }
    loggedHost = true;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function initNameCacheTable() {
  const db = getPool();
  if (!db) return;

  if (!initPromise) {
    initPromise = db
      .query(`
        CREATE TABLE IF NOT EXISTS certificados_name_cache (
          id TEXT PRIMARY KEY,
          documento TEXT,
          nombre TEXT,
          empresa TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `)
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }

  await initPromise;
}

async function getCachedName(id) {
  const db = getPool();
  if (!db || !id) return null;

  await initNameCacheTable();

  const result = await db.query(
    `
      SELECT nombre
      FROM certificados_name_cache
      WHERE id = $1
      LIMIT 1
    `,
    [String(id)]
  );

  return result.rows[0]?.nombre || null;
}

async function saveCachedName({ id, documento, nombre, empresa }) {
  const db = getPool();
  if (!db || !id || !nombre) return;

  await initNameCacheTable();

  await db.query(
    `
      INSERT INTO certificados_name_cache (id, documento, nombre, empresa, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        documento = EXCLUDED.documento,
        nombre = EXCLUDED.nombre,
        empresa = EXCLUDED.empresa,
        updated_at = NOW()
    `,
    [
      String(id),
      String(documento || ""),
      String(nombre || ""),
      String(empresa || ""),
    ]
  );
}

module.exports = {
  getCachedName,
  saveCachedName,
  initNameCacheTable,
};

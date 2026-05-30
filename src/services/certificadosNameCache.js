const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!process.env.CERTIFICADOS_DATABASE_URL) {
    console.warn("⚠️ CERTIFICADOS_DATABASE_URL no configurado. Cache de nombres desactivado.");
    return null;
  }

  try {
  console.log(
    "🔎 CERTIFICADOS_DATABASE_URL host:",
    new URL(process.env.CERTIFICADOS_DATABASE_URL).hostname
  );
} catch (e) {
  console.log("❌ CERTIFICADOS_DATABASE_URL inválida");
}

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.CERTIFICADOS_DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return pool;
}

async function initNameCacheTable() {
  const db = getPool();
  if (!db) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS certificados_name_cache (
      id TEXT PRIMARY KEY,
      documento TEXT,
      nombre TEXT,
      empresa TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
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
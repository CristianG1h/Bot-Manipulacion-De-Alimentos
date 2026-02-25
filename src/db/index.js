"use strict";

const { Pool } = require("pg");
const { DATABASE_URL } = require("../config");

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
}

async function dbQuery(text, params = []) {
  if (!pool) throw new Error("DB not configured");
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, dbQuery };
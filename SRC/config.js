"use strict";

module.exports = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || "vip_verify_123",
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || "1065395483314461",
  TOKEN: process.env.WHATSAPP_TOKEN,
  DATABASE_URL: process.env.DATABASE_URL,

  CLEANUP_EVERY_MS: 30 * 60 * 1000,

  // Nudge
  NUDGE_AFTER_MIN: 10,
  NUDGE_MAX: 2,
  NUDGE_CHECK_EVERY_MS: 60 * 1000,
  SESSION_EXPIRE_MIN: 60,

  // Rate limiting
  RATE_MAX_PER_MIN: 8,
  RATE_BLOCK_MIN: 5,
  TEXT_MAX_LEN: 500,

  GRAPH_VERSION: process.env.GRAPH_VERSION || "v22.0",
};
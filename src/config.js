"use strict";

module.exports = {
  VERIFY_TOKEN:    process.env.VERIFY_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  TOKEN:           process.env.WHATSAPP_TOKEN,

  // Rate limiting
  RATE_MAX_PER_MIN: 8,
  RATE_BLOCK_MIN:   5,
  TEXT_MAX_LEN:     500,

  GRAPH_VERSION: process.env.GRAPH_VERSION || "v22.0",
};

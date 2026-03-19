"use strict";

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`❌ Variable de entorno requerida no definida: ${name}`);
  return val;
}

module.exports = {
  // Variables requeridas — el servidor no arranca si alguna falta
  VERIFY_TOKEN:    required("VERIFY_TOKEN"),
  PHONE_NUMBER_ID: required("PHONE_NUMBER_ID"),
  TOKEN:           required("WHATSAPP_TOKEN"),
  COURSE_LINK:     required("COURSE_LINK"),
  COURSE_PASSWORD: required("COURSE_PASSWORD"),

  // Opcionales con defaults seguros
  GRAPH_VERSION: process.env.GRAPH_VERSION || "v22.0",
  PORT:          process.env.PORT          || 3000,

  // Rate limiting (constantes, no vienen de env)
  RATE_MAX_PER_MIN: 8,
  RATE_BLOCK_MIN:   5,
  TEXT_MAX_LEN:     500,
};

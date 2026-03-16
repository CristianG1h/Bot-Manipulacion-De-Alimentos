"use strict";

const express = require("express");
const { VERIFY_TOKEN } = require("../config");

const router = express.Router();

// Verificación del webhook de Meta.
// Lo puedes dejar por si todavía lo necesitas para pruebas o para otros endpoints futuros.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook Meta verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Si Meta todavía llegara aquí por error, solo responder 200 para no generar reintentos.
router.post("/", (req, res) => {
  console.log("ℹ️ POST /webhook recibido pero flujo principal ahora es Chatwoot");
  return res.status(200).json({ ok: true, ignored: "meta_webhook_not_in_use" });
});

module.exports = router;

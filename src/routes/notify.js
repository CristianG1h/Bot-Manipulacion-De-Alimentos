"use strict";

const express = require("express");
const { sendPayload } = require("../services/whatsapp");
const { normalizeCOCell } = require("../utils/validation");

const router = express.Router();
const API_KEY = process.env.API_KEY_NOTIFY;

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ ok: false, error: "API key not configured" });
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) return res.status(401).json({ ok: false, error: "Unauthorized" });
  return next();
}

router.post("/access", requireApiKey, async (req, res) => {
  try {
    const { to, name, user, password } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: "Missing 'to'" });

    // Normaliza a +57...
    const norm =
      (String(to).startsWith("57") || String(to).startsWith("+57"))
        ? { e164: String(to).startsWith("+") ? String(to) : `+${String(to)}` }
        : normalizeCOCell(String(to));

    if (!norm?.e164) return res.status(400).json({ ok: false, error: "Invalid phone number" });

    // Cloud API requiere "to" sin "+"
    const waTo = norm.e164.replace("+", "");

    // AJUSTA a tu plantilla real (nombre exacto):
    const TEMPLATE_NAME = "acceso_curso";
    const LANG = "es_CO";

    // Validación mínima de variables (opcional pero recomendado)
    if (!name || !user || !password) {
      return res.status(400).json({ ok: false, error: "Missing name/user/password" });
    }

    const payload = {
  messaging_product: "whatsapp",
  to: waTo,
  type: "template",
  template: {
    name: TEMPLATE_NAME,
    language: { code: LANG }
  }
};

    await sendPayload(payload);
    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ notify/access error:", e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

module.exports = router;

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

router.post("/", requireApiKey, async (req, res) => {
  try {
    const { to, name, certificate_url } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: "Missing 'to'" });
    if (!name || !certificate_url) {
      return res.status(400).json({ ok: false, error: "Missing name/certificate_url" });
    }

    const norm =
      String(to).startsWith("57") || String(to).startsWith("+57")
        ? { e164: String(to).startsWith("+") ? String(to) : `+${String(to)}` }
        : normalizeCOCell(String(to));

    if (!norm?.e164) return res.status(400).json({ ok: false, error: "Invalid phone number" });

    const waTo = norm.e164.replace("+", "");

    const TEMPLATE_NAME = "certificado_aprobado_v1"; // 👈 exacto de Meta
    const LANG = "es_CO"; // o "es" según tu plantilla

    const payload = {
      messaging_product: "whatsapp",
      to: waTo,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(name) },            // {{1}}
              { type: "text", text: String(certificate_url) }, // {{2}}
            ],
          },
        ],
      },
    };

    await sendPayload(payload);
    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ certificate route error:", e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

module.exports = router;

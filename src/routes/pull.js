"use strict";

const express = require("express");
const { getPendingRegistrations, markRegistrationProcessed } = require("../db/queries");

const router = express.Router();
const API_KEY = process.env.API_KEY_NOTIFY;

function requireApiKey(req, res, next) {
  if (!API_KEY) return res.status(500).json({ ok: false, error: "API key not configured" });
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) return res.status(401).json({ ok: false, error: "Unauthorized" });
  return next();
}

// ✅ PULL: obtener pendientes
router.get("/registrations/pending", requireApiKey, async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const data = await getPendingRegistrations(limit);
    return res.json({ ok: true, count: data.length, data });
  } catch (e) {
    console.error("❌ pending registrations error:", e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// ✅ Confirmación: marcar como procesado
router.patch("/registrations/:id/processed", requireApiKey, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "Invalid id" });

    const { page_user_id } = req.body || {};
    const updated = await markRegistrationProcessed(id, page_user_id || null);

    if (!updated) return res.status(404).json({ ok: false, error: "Not found" });

    return res.json({ ok: true, data: updated });
  } catch (e) {
    console.error("❌ mark processed error:", e);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

module.exports = router;

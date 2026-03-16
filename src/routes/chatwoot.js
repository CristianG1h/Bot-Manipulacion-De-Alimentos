"use strict";

const express = require("express");
const router = express.Router();

router.post("/webhook", async (req, res) => {
  // Responder rápido a Chatwoot para que no reintente
  res.status(200).json({ ok: true });

  try {
    const body = req.body;

    console.log("🔥 WEBHOOK RECIBIDO DESDE CHATWOOT");
    console.log("📩 CHATWOOT WEBHOOK:", JSON.stringify(body, null, 2));

    // Validar evento
    if (body.event !== "message_created") {
      console.log("⏭️ Evento ignorado:", body.event);
      return;
    }

    // Solo responder mensajes entrantes del usuario
    if (body.message_type !== "incoming") {
      console.log("⏭️ No es incoming:", body.message_type);
      return;
    }

    // Ignorar mensajes privados/notas internas
    if (body.private === true) {
      console.log("⏭️ Mensaje privado, ignorado");
      return;
    }

    const conversationId = body.conversation?.id;
    if (!conversationId) {
      console.log("❌ No llegó conversationId");
      return;
    }

    const baseUrl = (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const apiToken = process.env.CHATWOOT_API_TOKEN;

    console.log("📌 BASE URL:", baseUrl);
    console.log("📌 ACCOUNT ID:", accountId);
    console.log("📌 TOKEN EXISTE:", !!apiToken);

    if (!baseUrl || !accountId || !apiToken) {
      console.log("❌ Faltan variables de entorno CHATWOOT_*");
      return;
    }

    const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

    console.log("📤 Enviando a:", url);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: apiToken,
      },
      body: JSON.stringify({
        content: "Hola 👋 soy el bot desde Render",
        message_type: "outgoing",
        private: false,
      }),
    });

    const raw = await response.text();

    console.log("📤 STATUS:", response.status);
    console.log("📤 BODY:", raw);

    if (!response.ok) {
      console.log("❌ Chatwoot respondió con error");
    } else {
      console.log("✅ Respuesta enviada correctamente a Chatwoot");
    }
  } catch (error) {
    console.error("❌ ERROR CHATWOOT:", error);
  }
});

router.get("/webhook", (req, res) => {
  res.status(200).send("OK CHATWOOT WEBHOOK");
});

module.exports = router;

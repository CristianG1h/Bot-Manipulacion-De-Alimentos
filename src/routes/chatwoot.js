"use strict";

const express = require("express");
const router = express.Router();

router.post("/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = req.body;
    console.log("📩 CHATWOOT WEBHOOK:", JSON.stringify(body, null, 2));

    if (body.event !== "message_created") {
      console.log("⏭️ Evento ignorado:", body.event);
      return;
    }

    if (body.message_type !== "incoming") {
      console.log("⏭️ No es incoming:", body.message_type);
      return;
    }

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
  } catch (error) {
    console.error("❌ ERROR CHATWOOT:", error);
  }
});

module.exports = router;

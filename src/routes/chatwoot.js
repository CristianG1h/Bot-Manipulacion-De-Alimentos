// src/routes/chatwoot.js
"use strict";

const express = require("express");
const router = express.Router();

router.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    console.log("CHATWOOT WEBHOOK:", JSON.stringify(body, null, 2));

    const event = body.event;
    if (event !== "message_created") {
      return res.status(200).json({ ok: true, ignored: "event_not_needed" });
    }

    const messageType = body.message_type;
    const content = body.content || "";
    const conversationId = body.conversation?.id;

    // Solo responder mensajes entrantes del usuario
    if (messageType !== "incoming") {
      return res.status(200).json({ ok: true, ignored: "not_incoming" });
    }

    // Evitar responder mensajes vacíos
    if (!content.trim()) {
      return res.status(200).json({ ok: true, ignored: "empty_message" });
    }

    // Aquí va tu lógica del bot
    let reply = "Hola 👋 Gracias por escribirnos. ¿En qué podemos ayudarte?";

    const lower = content.toLowerCase();

    if (lower.includes("certificado")) {
      reply = "Claro. Por favor indícame tu número de cédula para ayudarte con el certificado.";
    } else if (lower.includes("curso")) {
      reply = "Con gusto. Te ayudamos con el curso de manipulación de alimentos. ¿Deseas información, registro o certificado?";
    } else if (lower.includes("ayuda")) {
      reply = "Estoy para ayudarte. Cuéntame qué necesitas y te orientamos.";
    }

    // Enviar respuesta a Chatwoot
    const response = await fetch(
      `${process.env.CHATWOOT_BASE_URL}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          api_access_token: process.env.CHATWOOT_API_TOKEN,
        },
        body: JSON.stringify({
          content: reply,
          message_type: "outgoing",
          private: false,
        }),
      }
    );

    const responseData = await response.text();
    console.log("CHATWOOT SEND RESPONSE:", response.status, responseData);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("CHATWOOT WEBHOOK ERROR:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;

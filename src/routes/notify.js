"use strict";

const express = require("express");
const { sendPayload } = require("../services/whatsapp");
const { normalizeCOCell } = require("../utils/validation");
const Stats = require("../services/stats");

const router = express.Router();
const API_KEY = process.env.API_KEY_NOTIFY;

function chatwootConfig() {
  return {
    baseUrl: String(process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, ""),
    accountId: process.env.CHATWOOT_ACCOUNT_ID,
    inboxId: Number(process.env.CHATWOOT_INBOX_ID || 0),
    apiToken: String(process.env.CHATWOOT_API_TOKEN || "").trim(),
  };
}

function chatwootActivo() {
  const cfg = chatwootConfig();
  return !!(cfg.baseUrl && cfg.accountId && cfg.inboxId && cfg.apiToken);
}

async function chatwootRequest(path, options = {}) {
  const cfg = chatwootConfig();

  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      api_access_token: cfg.apiToken,
      "api-access-token": cfg.apiToken,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok) {
    throw new Error(`Chatwoot API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

function extraerContactId(response) {
  return (
    response?.payload?.contact?.id ||
    response?.payload?.id ||
    response?.contact?.id ||
    response?.id ||
    null
  );
}

function extraerConversationId(response) {
  return (
    response?.id ||
    response?.payload?.id ||
    response?.conversation?.id ||
    response?.payload?.conversation?.id ||
    null
  );
}

async function buscarContactoChatwoot(phoneE164) {
  const cfg = chatwootConfig();
  const phone = String(phoneE164 || "").trim();
  const sinMas = phone.replace("+", "");

  const queries = [phone, sinMas];

  for (const query of queries) {
    const response = await chatwootRequest(
      `/api/v1/accounts/${cfg.accountId}/contacts/search?q=${encodeURIComponent(query)}`
    );

    const results = Array.isArray(response?.payload)
      ? response.payload
      : Array.isArray(response)
        ? response
        : [];

    const found = results.find((item) => {
      const contact = item.contact || item;
      const contactPhone = String(contact.phone_number || "").replace(/\s+/g, "");
      const identifier = String(contact.identifier || "");

      return (
        contactPhone === phone ||
        contactPhone === sinMas ||
        identifier === sinMas
      );
    });

    if (found) {
      const contact = found.contact || found;
      if (contact.id) return contact.id;
    }
  }

  return null;
}

async function crearContactoChatwoot(phoneE164, name) {
  const cfg = chatwootConfig();
  const phone = String(phoneE164 || "").trim();
  const sinMas = phone.replace("+", "");

  try {
    const response = await chatwootRequest(
      `/api/v1/accounts/${cfg.accountId}/contacts`,
      {
        method: "POST",
        body: {
          inbox_id: cfg.inboxId,
          name: name || `WhatsApp ${phone}`,
          phone_number: phone,
          identifier: sinMas,
          additional_attributes: {
            source: "notify_access_alimentos",
            wa_id: sinMas,
            inbox_id: cfg.inboxId,
          },
          custom_attributes: {
            canal: "WhatsApp",
            origen: "Bot Manipulación de Alimentos",
          },
        },
      }
    );

    return extraerContactId(response);
  } catch (error) {
    if (String(error.message).includes("Phone number has already been taken")) {
      return await buscarContactoChatwoot(phoneE164);
    }

    throw error;
  }
}

async function obtenerOCrearContactoChatwoot(phoneE164, name) {
  const existente = await buscarContactoChatwoot(phoneE164);
  if (existente) return existente;

  return await crearContactoChatwoot(phoneE164, name);
}

async function buscarConversacionChatwoot(contactId) {
  const cfg = chatwootConfig();

  const response = await chatwootRequest(
    `/api/v1/accounts/${cfg.accountId}/contacts/${contactId}/conversations`
  );

  const conversations = Array.isArray(response?.payload)
    ? response.payload
    : Array.isArray(response)
      ? response
      : [];

  const mismaBandeja = conversations.filter((c) => {
    const inboxId =
      c.inbox_id ||
      c.inbox?.id ||
      c.meta?.inbox?.id ||
      c.additional_attributes?.inbox_id ||
      null;

    return Number(inboxId) === Number(cfg.inboxId);
  });

  if (!mismaBandeja.length) return null;

  const abierta =
    mismaBandeja.find((c) => c.status === "open") ||
    mismaBandeja[0];

  return abierta?.id || null;
}

async function crearConversacionChatwoot(phoneE164, contactId) {
  const cfg = chatwootConfig();
  const sinMas = String(phoneE164 || "").replace("+", "");

  const response = await chatwootRequest(
    `/api/v1/accounts/${cfg.accountId}/conversations`,
    {
      method: "POST",
      body: {
        source_id: `whatsapp:${sinMas}`,
        inbox_id: cfg.inboxId,
        contact_id: contactId,
        status: "open",
        additional_attributes: {
          source: "notify_access_alimentos",
          inbox_id: cfg.inboxId,
        },
        custom_attributes: {
          canal: "WhatsApp",
          origen: "Bot Manipulación de Alimentos",
        },
      },
    }
  );

  return extraerConversationId(response);
}

async function obtenerOCrearConversacionChatwoot(phoneE164, name) {
  const contactId = await obtenerOCrearContactoChatwoot(phoneE164, name);

  if (!contactId) {
    throw new Error("No se pudo obtener contactId para Chatwoot");
  }

  const existente = await buscarConversacionChatwoot(contactId);
  if (existente) return existente;

  return await crearConversacionChatwoot(phoneE164, contactId);
}

async function crearNotaAccesoCurso({
  phoneE164,
  name,
}) {
  if (!chatwootActivo()) {
    console.log(
      "⚠️ Chatwoot no configurado para nota privada de acceso"
    );

    return;
  }


  try {
    const cfg = chatwootConfig();

    const conversationId =
      await obtenerOCrearConversacionChatwoot(
        phoneE164,
        name
      );


    if (!conversationId) {
      console.log(
        "⚠️ No se pudo crear/encontrar conversación en Chatwoot"
      );

      return;
    }


    const contenido =
      `✅ *Acceso a plataforma enviado automáticamente*

👤 Nombre: ${name}

📚 Curso: Manipulación de Alimentos
📩 Plantilla: acceso_curso1
📌 Estado: enviado correctamente

🔐 Las credenciales fueron enviadas directamente al usuario por WhatsApp y no se almacenan en esta nota.`;


    await chatwootRequest(
      `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/messages`,
      {
        method: "POST",

        body: {
          content: contenido,
          message_type: "outgoing",
          private: true,
        },
      }
    );


    console.log(
      "📝 Nota privada de acceso creada en Chatwoot"
    );
  } catch (error) {
    console.error(
      "⚠️ Error creando nota privada de acceso:",
      error.message
    );
  }
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return res.status(500).json({ ok: false, error: "API key not configured" });
  }

  const key = req.header("x-api-key");

  if (!key || key !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  return next();
}

router.post("/access", requireApiKey, async (req, res) => {
  try {
    const { to, name, user, password } = req.body || {};

    if (!to) {
      return res.status(400).json({ ok: false, error: "Missing 'to'" });
    }

    if (!name || !user || !password) {
      return res.status(400).json({ ok: false, error: "Missing name/user/password" });
    }

    const norm =
      String(to).startsWith("57") || String(to).startsWith("+57")
        ? { e164: String(to).startsWith("+") ? String(to) : `+${String(to)}` }
        : normalizeCOCell(String(to));

    if (!norm?.e164) {
      return res.status(400).json({ ok: false, error: "Invalid phone number" });
    }

    const waTo = norm.e164.replace("+", "");

    const TEMPLATE_NAME = "acceso_curso1";
    const LANG = "es_CO";

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
              { type: "text", text: String(name) },
              { type: "text", text: String(user) },
              { type: "text", text: String(password) },
            ],
          },
        ],
      },
    };

    const result = await sendPayload(payload);

    if (!result) {
      Stats.metaError(`No se pudo enviar acceso a ${name}`);
      return res.status(502).json({
        ok: false,
        error: "No se pudo enviar el mensaje por WhatsApp",
      });
    }

    Stats.accesoEnviado();

    await crearNotaAccesoCurso({
  phoneE164: norm.e164,
  name: String(name),
});

    return res.json({ ok: true });
  } catch (e) {
    console.error("❌ notify/access error:", e);
    Stats.metaError(`notify/access error: ${e.message}`);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

module.exports = router;
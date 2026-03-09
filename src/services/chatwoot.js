"use strict";

const CHATWOOT_URL = process.env.CHATWOOT_URL;
const CHATWOOT_INBOX_IDENTIFIER = process.env.CHATWOOT_INBOX_IDENTIFIER;

function getBaseUrl() {
  if (!CHATWOOT_URL) throw new Error("CHATWOOT_URL no configurado");
  return CHATWOOT_URL.replace(/\/+$/, "");
}

async function cwFetch(path, options = {}) {
  const url = `${getBaseUrl()}${path}`;

  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Chatwoot ${res.status}: ${raw}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function createContact({ phone, name }) {
  return cwFetch(`/public/api/v1/inboxes/${CHATWOOT_INBOX_IDENTIFIER}/contacts`, {
    method: "POST",
    body: {
      name: name || phone,
      identifier: phone,
      phone_number: `+${phone.replace(/\D/g, "")}`,
    },
  });
}

async function createConversation(sourceId) {
  return cwFetch(
    `/public/api/v1/inboxes/${CHATWOOT_INBOX_IDENTIFIER}/contacts/${sourceId}/conversations`,
    {
      method: "POST",
      body: {},
    }
  );
}

async function sendMessage(sourceId, conversationId, message) {
  return cwFetch(
    `/public/api/v1/inboxes/${CHATWOOT_INBOX_IDENTIFIER}/contacts/${sourceId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: {
        content: message,
      },
    }
  );
}

async function sendToChatwoot({ phone, name, message }) {
  if (!CHATWOOT_URL || !CHATWOOT_INBOX_IDENTIFIER) {
    console.log("ℹ️ Chatwoot no configurado. Se omite sincronización.");
    return null;
  }

  const contact = await createContact({ phone, name });

  const sourceId =
    contact?.source_id ||
    contact?.id ||
    contact?.contact_inbox?.source_id;

  if (!sourceId) {
    throw new Error(`No se pudo obtener source_id del contacto: ${JSON.stringify(contact)}`);
  }

  const conversation = await createConversation(sourceId);

  const conversationId =
    conversation?.id ||
    conversation?.conversation_id;

  if (!conversationId) {
    throw new Error(`No se pudo obtener conversationId: ${JSON.stringify(conversation)}`);
  }

  return sendMessage(sourceId, conversationId, message);
}

module.exports = {
  sendToChatwoot,
};

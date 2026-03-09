"use strict";

const CHATWOOT_URL = process.env.CHATWOOT_URL;
const CHATWOOT_INBOX_IDENTIFIER = process.env.CHATWOOT_INBOX_IDENTIFIER;

async function sendToChatwoot({ phone, name, message }) {
  if (!CHATWOOT_URL || !CHATWOOT_INBOX_IDENTIFIER) {
    console.log("ℹ️ Chatwoot no configurado. Se omite sincronización.");
    return null;
  }

  const cleanBase = CHATWOOT_URL.replace(/\/+$/, "");
  const url = `${cleanBase}/public/api/v1/inboxes/${CHATWOOT_INBOX_IDENTIFIER}/contacts`;

  const payload = {
    name: name || phone,
    phone_number: phone,
    identifier: phone,
    message: {
      content: message
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
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

module.exports = {
  sendToChatwoot
};

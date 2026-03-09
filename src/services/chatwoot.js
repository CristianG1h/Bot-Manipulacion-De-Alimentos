"use strict";

const CHATWOOT_URL = "https://unconsidering-larissa-lashed.ngrok-free.dev/";
const INBOX_IDENTIFIER = "2F4YzZ8mJxEECGiyUguC9xB1";

async function sendToChatwoot({ phone, name, message }) {

  const response = await fetch(
    `${CHATWOOT_URL}/public/api/v1/inboxes/${INBOX_IDENTIFIER}/contacts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: name,
        phone_number: phone,
        message: {
          content: message
        }
      })
    }
  );

  const data = await response.json();
  return data;
}

module.exports = {
  sendToChatwoot
};

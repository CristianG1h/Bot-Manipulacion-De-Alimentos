"use strict";

const express = require("express");
const router = express.Router();

const { sendPayload, sendText } = require("../services/whatsapp");
const { isRateLimited } = require("../utils/rateLimit");
const { TEXT_MAX_LEN, COURSE_LINK, COURSE_PASSWORD } = require("../config");
const Stats = require("../services/stats");

// ─── Protección webhook ───────────────────────────────────────────────────────
const WEBHOOK_TOKEN = process.env.CHATWOOT_WEBHOOK_TOKEN;

// ─── Deduplicación en memoria ─────────────────────────────────────────────────
const processedIds = new Set();
setInterval(() => processedIds.clear(), 24 * 60 * 60 * 1000);

// ─── Modo asesor ──────────────────────────────────────────────────────────────

const advisorMode = new Map();

const ADVISOR_TIMEOUT_MS = 5 * 60 * 1000;


/**
 * Programa o reinicia el temporizador del modo asesor.
 *
 * advisorMode:
 * wa_id => {
 *   timer,
 *   humanResponded
 * }
 */
function programarTimeoutAsesor(
  wa_id,
  humanResponded = false
) {
  const estadoAnterior = advisorMode.get(wa_id);

  if (estadoAnterior?.timer) {
    clearTimeout(estadoAnterior.timer);
  }


  const timer = setTimeout(async () => {
    const estadoActual = advisorMode.get(wa_id);

    advisorMode.delete(wa_id);


    // El asesor nunca respondió.
    if (!estadoActual?.humanResponded) {
      console.log(
        `⏰ Sin respuesta del asesor para ${wa_id} — bot retoma`
      );

      const msg =
        "⏱️ Han pasado 5 minutos sin respuesta de nuestro equipo.\n\n" +
        "Si aún necesitas ayuda puedes:\n\n" +
        "📱 Llamarnos al *313 401 0901*\n" +
        "📄 O escribir *instructivo* para recibir el link del curso.\n\n" +
        "Seguimos a tu disposición. 🙌";

      try {
        await sendText(wa_id, msg);
      } catch (error) {
        console.error(
          `❌ Error enviando mensaje de timeout a ${wa_id}:`,
          error.message
        );
      }

      return;
    }


    // El asesor sí respondió.
    // Después de 5 minutos sin actividad,
    // el bot retoma silenciosamente.
    console.log(
      `✅ Atención humana inactiva por 5 minutos para ${wa_id} — bot retoma silenciosamente`
    );
  }, ADVISOR_TIMEOUT_MS);


  advisorMode.set(wa_id, {
    timer,
    humanResponded,
  });
}


/**
 * Activa inicialmente el modo asesor.
 */
function setAdvisorMode(wa_id) {
  programarTimeoutAsesor(
    wa_id,
    false
  );

  console.log(
    `👤 Modo asesor activado para ${wa_id}`
  );
}


/**
 * El usuario escribió mientras un asesor
 * tiene el control.
 *
 * Reinicia el temporizador conservando
 * si el asesor ya había respondido.
 */
function registrarActividadUsuarioModoAsesor(wa_id) {
  const estado = advisorMode.get(wa_id);

  if (!estado) {
    return;
  }

  programarTimeoutAsesor(
    wa_id,
    estado.humanResponded === true
  );

  console.log(
    `💬 Usuario ${wa_id} escribió durante modo asesor — timeout reiniciado`
  );
}


/**
 * Un agente humano respondió desde Chatwoot.
 */
function registrarRespuestaAsesor(wa_id) {
  const estado = advisorMode.get(wa_id);

  if (!estado) {
    return;
  }

  programarTimeoutAsesor(
    wa_id,
    true
  );

  console.log(
    `👨‍💼 Asesor respondió a ${wa_id} — timeout reiniciado`
  );
}


/**
 * Desactiva completamente el modo asesor.
 */
function clearAdvisorMode(
  wa_id,
  log = true
) {
  const estado = advisorMode.get(wa_id);

  if (estado?.timer) {
    clearTimeout(estado.timer);
  }

  advisorMode.delete(wa_id);


  if (log && estado) {
    console.log(
      `✅ Modo asesor desactivado para ${wa_id}`
    );
  }
}

function extractButtonId(body) {
  const id = body.content_attributes?.items?.[0]?.reply?.id;
  if (id) return id;

  const text = (body.content || "").trim().toLowerCase();

  if (text === "📄 instructivo y link" || text === "instructivo y link") {
    return "ver_instructivo";
  }

  if (text === "💬 hablar con asesor" || text === "hablar con asesor") {
    return "hablar_asesor";
  }

  return null;
}

function obtenerInboxIdDesdePayload(body) {
  return (
    body.inbox?.id ||
    body.inbox_id ||
    body.conversation?.inbox_id ||
    body.conversation?.inbox?.id ||
    body.message?.inbox_id ||
    body.message?.inbox?.id ||
    body.conversation?.meta?.inbox?.id ||
    body.conversation?.contact_inbox?.inbox_id ||
    body.contact_inbox?.inbox_id ||
    null
  );
}

async function crearNotaPrivadaChatwoot(conversationId, contenido) {
  try {
    if (!conversationId || !contenido) return;

    const baseUrl = (process.env.CHATWOOT_BASE_URL || "").replace(/\/+$/, "");
    const accountId = process.env.CHATWOOT_ACCOUNT_ID;
    const apiToken = String(process.env.CHATWOOT_API_TOKEN || "").trim();

    if (!baseUrl || !accountId || !apiToken) {
      console.log("⚠️ No se creó nota privada: faltan variables CHATWOOT_*");
      return;
    }

    const url = `${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: apiToken,
        "api-access-token": apiToken,
      },
      body: JSON.stringify({
        content: `🤖 *Respuesta del bot:*\n\n${contenido}`,
        message_type: "outgoing",
        private: true,
      }),
    });

    const raw = await response.text();

    if (!response.ok) {
      console.log("⚠️ Error creando nota privada en Chatwoot:", response.status, raw);
      return;
    }

    console.log("📝 Nota privada creada en Chatwoot");
  } catch (error) {
    console.error("❌ Error creando nota privada:", error.message);
  }
}

// ─── Rutas ────────────────────────────────────────────────────────────────────
router.get("/webhook", (req, res) => res.status(200).send("OK"));

router.post("/webhook", async (req, res) => {
  // Fail-closed:
  // si el servidor no tiene token configurado,
  // ningún webhook puede ser procesado.
  if (!WEBHOOK_TOKEN) {
    console.error(
      "❌ Webhook deshabilitado: falta CHATWOOT_WEBHOOK_TOKEN"
    );

    return res.status(503).json({
      ok: false,
      error: "Webhook no configurado",
    });
  }

  const receivedToken = String(req.query.token || "");

  if (receivedToken !== WEBHOOK_TOKEN) {
    console.warn(
      "⚠️ Webhook rechazado — token inválido o ausente"
    );

    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  res.status(200).json({ ok: true });

  try {
    const body = req.body;


if (body.event !== "message_created") {
  return;
}


// Las notas privadas no deben afectar
// el temporizador del asesor.
if (body.private === true) {
  return;
}


const messageType = String(
  body.message_type ?? ""
).toLowerCase();

const esIncoming =
  messageType === "incoming" ||
  messageType === "0";

const esOutgoing =
  messageType === "outgoing" ||
  messageType === "1";


// ─────────────────────────────────────────────
// FILTRO POR INBOX
// ─────────────────────────────────────────────

const expectedInboxId = Number(
  process.env.CHATWOOT_INBOX_ID || 0
);

const payloadInboxId =
  obtenerInboxIdDesdePayload(body);


if (!expectedInboxId) {
  console.log(
    "❌ Falta configurar CHATWOOT_INBOX_ID en Render. Mensaje ignorado."
  );

  return;
}


if (!payloadInboxId) {
  console.log(
    "⚠️ Webhook Chatwoot sin inbox_id claro. Mensaje ignorado."
  );

  return;
}


if (
  Number(payloadInboxId) !==
  expectedInboxId
) {
  console.log(
    `⏭️ Mensaje ignorado por inbox diferente. Esperado: ${expectedInboxId}, recibido: ${payloadInboxId}`
  );

  return;
}


console.log(
  "✅ Inbox correcto para Curso de Alimentos:",
  payloadInboxId
);


// ─────────────────────────────────────────────
// IDENTIFICAR CONTACTO
// ─────────────────────────────────────────────

const rawPhone =
  body.meta?.sender?.phone_number ||
  body.conversation?.meta?.sender?.phone_number ||
  body.contact?.phone_number ||
  null;


if (!rawPhone) {
  console.log(
    "❌ No se pudo extraer teléfono del payload Chatwoot"
  );

  return;
}


const wa_id =
  String(rawPhone).replace(/\D/g, "");


const conversationId =
  body.conversation?.id ||
  body.conversation_id ||
  null;


// ─────────────────────────────────────────────
// RESPUESTA DEL ASESOR DESDE CHATWOOT
// ─────────────────────────────────────────────

if (esOutgoing) {
  const senderType = String(
    body.sender?.type || ""
  ).toLowerCase();


  // Chatwoot identifica al agente humano
  // como sender.type = "user".
  if (senderType !== "user") {
    console.log(
      `⏭️ Mensaje outgoing no humano ignorado. sender.type=${senderType || "desconocido"}`
    );

    return;
  }


  if (advisorMode.has(wa_id)) {
    registrarRespuestaAsesor(wa_id);
  }

  return;
}


// El bot solamente procesa contenido del cliente.
if (!esIncoming) {
  return;
}


console.log(`📩 Mensaje de ${wa_id}`);


Stats.mensajeRecibido(wa_id);


// ─────────────────────────────────────────────
// RATE LIMIT
// ─────────────────────────────────────────────

const rl = isRateLimited(wa_id);


if (rl.limited) {
  Stats.rateLimitado(wa_id);

  if (rl.reason === "too_many") {
    await sendText(
      wa_id,
      "⚠️ Demasiados mensajes seguidos. Intenta en unos minutos."
    );
  }

  return;
}


// ─────────────────────────────────────────────
// DEDUPLICACIÓN
// ─────────────────────────────────────────────

const messageId =
  body.id
    ? String(body.id)
    : null;


if (messageId) {
  if (processedIds.has(messageId)) {
    console.log(
      "⏭️ Duplicado ignorado:",
      messageId
    );

    Stats.duplicadoIgnorado(messageId);

    return;
  }

  processedIds.add(messageId);
}


// ─────────────────────────────────────────────
// BOTONES
// ─────────────────────────────────────────────

const buttonId = extractButtonId(body);


if (buttonId) {
  console.log(
    "🔘 Botón:",
    buttonId
  );

  clearAdvisorMode(wa_id);

  return await handleButton(
    wa_id,
    buttonId,
    conversationId
  );
}


// ─────────────────────────────────────────────
// USUARIO EN MODO ASESOR
// ─────────────────────────────────────────────

if (advisorMode.has(wa_id)) {
  console.log(
    `🤐 ${wa_id} en modo asesor — bot silenciado`
  );

  registrarActividadUsuarioModoAsesor(
    wa_id
  );

  return;
}

    const rawText = (body.content || "").trim();

    if (!rawText) return;

    if (rawText.length > TEXT_MAX_LEN) {
      await sendText(wa_id, `⚠️ Mensaje muy largo. Máximo ${TEXT_MAX_LEN} caracteres.`);
      Stats.mensajeNoReconocido(wa_id, "Mensaje muy largo");
      return;
    }

    const t = rawText.toLowerCase();

    const saludos = [
      "hola",
      "buenas",
      "buenos días",
      "buen día",
      "buenas tardes",
      "buenas noches",
      "inicio",
      "menu",
      "menú",
      "start",
      "hi",
      "hello",
      "👋",
    ];

    const recibidoKw = [
      "ok, recibido",
      "ok recibido",
      "recibido",
      "ok recivido",
      "recivido",
    ];

    const cursoKw = [
      "instructivo",
      "link",
      "enlace",
      "curso",
      "acceso",
      "contraseña",
      "clave",
      "usuario",
      "certificado",
    ];

    if (saludos.includes(t)) {
      return await sendMainMenu(wa_id, conversationId);
    }

    if (recibidoKw.some((k) => t.includes(k))) {
      return await sendRecibidoConfirmacion(wa_id, conversationId);
    }

    if (cursoKw.some((k) => t.includes(k))) {
      return await sendCourseInfo(wa_id, conversationId);
    }

    console.log(`🤷 Mensaje no reconocido de ${wa_id}: "${rawText}"`);

    Stats.mensajeNoReconocido(wa_id, rawText);
    Stats.asesorActivado(wa_id);

    setAdvisorMode(wa_id);

    const msgAsesor =
      "👋 Gracias por escribirnos.\n\n" +
      "Un asesor revisará tu mensaje y te responderá en breve. 🙌\n\n" +
      "Si deseas atención más rápida, comunícate al:\n" +
      "📱 *313 401 0901*";

    await sendText(wa_id, msgAsesor);
    await crearNotaPrivadaChatwoot(conversationId, msgAsesor);
  } catch (error) {
    console.error("❌ Error en /chatwoot/webhook:", error);
    Stats.metaError(`Error en /chatwoot/webhook: ${error.message}`);
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────
async function handleButton(wa_id, buttonId, conversationId = null) {
  if (buttonId === "ver_instructivo") {
    return await sendCourseInfo(wa_id, conversationId);
  }

  if (buttonId === "hablar_asesor") {
    setAdvisorMode(wa_id);
    Stats.asesorActivado(wa_id);

    const msgAsesor =
      "👤 *Atención personalizada*\n\n" +
      "¡Listo! Un asesor se unirá a la conversación en breve. 🙌\n\n" +
      "Si deseas atención más rápida, escríbenos al:\n" +
      "📱 *313 401 0901*\n\n" +
      "_Si no recibes respuesta en 5 minutos, el asistente automático retomará la conversación._";

    await sendText(wa_id, msgAsesor);
    await crearNotaPrivadaChatwoot(conversationId, msgAsesor);
    return;
  }

  return await sendMainMenu(wa_id, conversationId);
}

async function sendMainMenu(to, conversationId = null) {
  const menuText =
    "✨ *VIP Salud Ocupacional*\n\n" +
    "¡Hola! 👋 Bienvenido(a) al *Curso de Manipulación de Alimentos*.\n\n" +
    "¿En qué te podemos ayudar?";

  const result = await sendPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: menuText,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "ver_instructivo", title: "📄 Instructivo y link" } },
          { type: "reply", reply: { id: "hablar_asesor", title: "💬 Hablar con asesor" } },
        ],
      },
    },
  });

  if (result) {
    Stats.menuEnviado(to);
  }

  await crearNotaPrivadaChatwoot(
    conversationId,
    `${menuText}

Botones enviados:
1️⃣ 📄 Instructivo y link
2️⃣ 💬 Hablar con asesor`
  );

  return result;
}

async function sendCourseInfo(to, conversationId = null) {
  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "Aquí tienes el acceso para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al enlace:\n${COURSE_LINK}\n\n` +
    "2️⃣ Usuario: CEDULA\n" +
    `🔐 Contraseña: ${COURSE_PASSWORD}\n\n` +
    "3️⃣ Haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y completa toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu *certificado* y demás documentos.\n\n" +
    "Si tienes alguna dificultad, escríbenos y te ayudamos. 🙌";

  await sendText(to, msg);
  Stats.instructivoEnviado(to);

  await crearNotaPrivadaChatwoot(
  conversationId,
  `🎓 *Información del curso enviada automáticamente*

📚 Curso: Manipulación de Alimentos
📌 Estado: información enviada correctamente

🔐 El enlace y las credenciales fueron enviados directamente al usuario por WhatsApp y no se almacenan en esta nota.`
);
}

async function sendRecibidoConfirmacion(to, conversationId = null) {
  const msg =
    "✨ *Perfecto, muchas gracias por confirmar* ✅\n\n" +
    "🎓 Ya puedes iniciar tu curso de *Manipulación de Alimentos*.\n\n" +
    "⏳ Te recomendamos realizarlo dentro de las próximas *24 horas* para que puedas avanzar sin demoras y descargar tu certificado a tiempo.\n\n" +
    "💡 Si necesitas más tiempo o tienes algún inconveniente para ingresar, escríbenos por este mismo chat y con gusto te ayudamos.\n\n" +
    "🙌 Estamos pendientes para apoyarte.";

  await sendText(to, msg);
  Stats.recibidoEnviado(to);

  await crearNotaPrivadaChatwoot(conversationId, msg);
}

module.exports = router;
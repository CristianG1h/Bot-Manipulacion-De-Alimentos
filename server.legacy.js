"use strict";

const express = require("express");
const { Pool } = require("pg");

// Node 18+ trae fetch nativo. Si en tu entorno no, instala node-fetch y descomenta:
// const fetch = global.fetch || require("node-fetch");

const app = express();
app.use(express.json());

// ====== CONFIG ======
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "vip_verify_123";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "1065395483314461";
const TOKEN = process.env.WHATSAPP_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

let lastCleanupAt = 0;
const CLEANUP_EVERY_MS = 30 * 60 * 1000; // 30 minutos

// ====== Reintento inteligente (nudge) ======
const NUDGE_AFTER_MIN = 10; // si no responde en 10 min
const NUDGE_MAX = 2; // máximo 2 recordatorios
const NUDGE_CHECK_EVERY_MS = 60 * 1000; // revisar cada 1 min
const SESSION_EXPIRE_MIN = 60; // expira sesión tras 60 min sin responder (opcional)

// ====== Anti-Spam / Rate limiting ======
const RATE_MAX_PER_MIN = 8; // máximo mensajes por minuto por usuario
const RATE_BLOCK_MIN = 5; // bloqueo temporal si excede rate
const TEXT_MAX_LEN = 500; // longitud máxima de texto
const rateState = new Map(); // wa_id -> { ts: number[], blockedUntil: number }

if (!TOKEN) {
  console.warn("⚠️ Falta WHATSAPP_TOKEN. El bot recibirá webhooks pero NO podrá enviar mensajes.");
}

if (!DATABASE_URL) {
  console.warn("⚠️ Falta DATABASE_URL. El bot NO podrá guardar registros/sesiones en PostgreSQL.");
}

// ====== POSTGRES ======
let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });
}

async function dbQuery(text, params = []) {
  if (!pool) throw new Error("DB not configured");
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDb() {
  if (!DATABASE_URL) return;

  // Tabla registrations: 1 registro por wa_id (se actualiza si vuelve a registrarse)
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      wa_id TEXT NOT NULL UNIQUE,
      full_name TEXT,
      cedula TEXT,
      celular TEXT,
      correo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Índice único para evitar cédulas duplicadas entre diferentes wa_id
  await dbQuery(`CREATE UNIQUE INDEX IF NOT EXISTS ux_registrations_cedula ON registrations (cedula);`);

  // Tabla sessions: 1 sesión por wa_id
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS sessions (
      wa_id TEXT PRIMARY KEY,
      step TEXT NOT NULL,
      temp_full_name TEXT,
      temp_cedula TEXT,
      temp_celular TEXT,
      temp_correo TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Columnas para reintento inteligente (si no existen)
  await dbQuery(`
    ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_nudge_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS nudge_count INT NOT NULL DEFAULT 0;
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_processed_messages_created_at
    ON processed_messages (created_at);
  `);

  console.log("✅ PostgreSQL listo (tablas verificadas/creadas).");
}

// ====== WEBHOOK VERIFY (GET) ======
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ====== WEBHOOK RECEIVE (POST) ======
app.post("/webhook", (req, res) => {
  // Responder rápido a Meta
  res.sendStatus(200);

  (async () => {
    try {
      const body = req.body;

      const change = body?.entry?.[0]?.changes?.[0];
      const value = change?.value;

      // Ignorar estados
      const msg = value?.messages?.[0];
      if (!msg) return;

      const from = msg.from;

      // ====== Rate limiting antes de procesar ======
      const rl = isRateLimited(from);
      if (rl.limited) {
        if (TOKEN && rl.reason === "too_many") {
          await sendText(from, "⚠️ Estás enviando muchos mensajes muy rápido. Intenta de nuevo en unos minutos.");
        }
        return;
      }

      // ====== Deduplicación de mensajes (si hay DB) ======
      const messageId = msg.id;
      if (messageId && DATABASE_URL) {
        const already = await isProcessedMessage(messageId);
        if (already) {
          console.log("⏭️ Mensaje duplicado ignorado:", messageId);
          return;
        }
        await markMessageProcessed(messageId);

        const now = Date.now();
        if (now - lastCleanupAt > CLEANUP_EVERY_MS) {
          lastCleanupAt = now;
          cleanupProcessedMessages().catch((e) => console.error("❌ Cleanup error:", e));
        }
      }

      // Actualiza last_inbound_at si tiene sesión
      await touchSessionInbound(from);

      // Si es botón
      const buttonId = msg?.interactive?.button_reply?.id;
      if (buttonId) {
        console.log("✅ Botón:", buttonId);

        if (buttonId === "registrarme") return await startRegistration(from);
        if (buttonId === "enlace") return await sendCourseInfo(from);
        if (buttonId === "asesor")
          return await sendText(
            from,
            "📞 *Atención personalizada*\n\n" +
              "Este canal funciona únicamente con sistema automático.\n\n" +
              "Para hablar con un asesor, comunícate directamente al:\n\n" +
              "📱 *313 401 0901*\n\n" +
              "Con gusto te ayudaremos."
          );

        // Reintento inteligente: continuar / cancelar
        if (buttonId === "continue_reg") {
          const session = await getSession(from);
          if (!session) return await startRegistration(from);
          return await resendStepPrompt(from, session.step);
        }

        if (buttonId === "cancel_reg") {
          await deleteSession(from);
          await sendText(from, "✅ Listo. Cancelamos el registro. Si deseas empezar de nuevo presiona *📋 Registrarme*.");
          return await sendMainMenu(from);
        }

        // ====== Confirmación final ======
        if (buttonId === "confirm_reg") {
          return await finalizeRegistration(from);
        }

        if (buttonId === "edit_reg") {
          return await sendEditMenu(from);
        }

        // ====== Edición / corrección ======
        if (buttonId === "edit_name") {
          await updateSession(from, { step: "FULL_NAME" });
          return await sendText(from, "✏️ Escribe nuevamente tu *Nombre y Apellido completo*.");
        }
        if (buttonId === "edit_cedula") {
          await updateSession(from, { step: "CEDULA" });
          return await sendText(from, "✏️ Escribe nuevamente tu *número de cédula* (solo números).");
        }
        if (buttonId === "edit_cell") {
          await updateSession(from, { step: "CELULAR" });
          return await sendText(from, "✏️ Escribe nuevamente tu *celular* (10 dígitos, ej: 3001234567).");
        }
        if (buttonId === "edit_email") {
          await updateSession(from, { step: "CORREO" });
          return await sendText(from, "✏️ Escribe nuevamente tu *correo electrónico*.");
        }
        if (buttonId === "back_menu") {
          return await sendMainMenu(from);
        }

        return await sendMainMenu(from);
      }

      // Texto normal
      const text = (msg.text?.body || "").trim();

      if (text && text.length > TEXT_MAX_LEN) {
        await sendText(from, `⚠️ El mensaje es muy largo. Envíalo en menos de ${TEXT_MAX_LEN} caracteres.`);
        return;
      }

      // Comandos por texto (por si no usan botones)
      const t = text.toLowerCase();
      if (t === "menu" || t === "menú") return await sendMainMenu(from);
      if (t === "registrarme" || t === "registro") return await startRegistration(from);
      if (t === "enlace" || t === "link") return await sendCourseInfo(from);

      if (t === "ayuda" || t === "asesor") {
        return await sendText(
          from,
          "📞 *Atención personalizada*\n\n" +
            "Para hablar con un asesor, comunícate directamente al:\n\n" +
            "📱 *313 401 0901*"
        );
      }

      if (t === "cancelar" || t === "cancel") {
        await deleteSession(from);
        await sendText(from, "✅ Proceso cancelado. Si deseas iniciar de nuevo presiona *📋 Registrarme*.");
        return await sendMainMenu(from);
      }

      // Comandos para corrección (texto)
      if (t === "corregir" || t === "editar" || t === "me equivoqué" || t === "me equivoque") {
        const session = await getSession(from);
        if (!session) {
          await sendText(from, "No veo un registro en curso. Presiona *📋 Registrarme* para iniciar.");
          return;
        }
        return await sendEditMenu(from);
      }

      // Si está en sesión de registro, procesar el paso
      const session = await getSession(from);
      if (session) {
        return await handleRegistrationStep(from, session.step, text);
      }

      // Por defecto: mostrar menú
      return await sendMainMenu(from);
    } catch (e) {
      console.error("❌ Error procesando webhook:", e);
    }
  })();
});

// ====== Rate limiting helpers ======
function isRateLimited(wa_id) {
  const now = Date.now();
  const s = rateState.get(wa_id) || { ts: [], blockedUntil: 0 };

  if (s.blockedUntil && now < s.blockedUntil) {
    rateState.set(wa_id, s);
    return { limited: true, reason: "blocked" };
  }

  // limpia timestamps > 60s
  s.ts = s.ts.filter((t) => now - t < 60_000);
  s.ts.push(now);

  if (s.ts.length > RATE_MAX_PER_MIN) {
    s.blockedUntil = now + RATE_BLOCK_MIN * 60_000;
    rateState.set(wa_id, s);
    return { limited: true, reason: "too_many" };
  }

  rateState.set(wa_id, s);
  return { limited: false };
}

// ====== DB HELPERS ======
async function getSession(wa_id) {
  if (!DATABASE_URL) return null;
  const r = await dbQuery(`SELECT * FROM sessions WHERE wa_id = $1`, [wa_id]);
  return r.rows[0] || null;
}

async function touchSessionInbound(wa_id) {
  if (!DATABASE_URL) return;
  await dbQuery(
    `
    UPDATE sessions
    SET last_inbound_at = NOW(), updated_at = NOW()
    WHERE wa_id = $1
  `,
    [wa_id]
  );
}

async function upsertSessionReset(wa_id) {
  if (!DATABASE_URL) return;

  await dbQuery(
    `
    INSERT INTO sessions (
      wa_id, step, temp_full_name, temp_cedula, temp_celular, temp_correo,
      updated_at, last_inbound_at, last_nudge_at, nudge_count
    )
    VALUES ($1, 'FULL_NAME', NULL, NULL, NULL, NULL, NOW(), NOW(), NULL, 0)
    ON CONFLICT (wa_id)
    DO UPDATE SET
      step = 'FULL_NAME',
      temp_full_name = NULL,
      temp_cedula = NULL,
      temp_celular = NULL,
      temp_correo = NULL,
      updated_at = NOW(),
      last_inbound_at = NOW(),
      last_nudge_at = NULL,
      nudge_count = 0;
    `,
    [wa_id]
  );
}

async function isProcessedMessage(message_id) {
  if (!DATABASE_URL) return false;
  const r = await dbQuery(`SELECT 1 FROM processed_messages WHERE message_id = $1`, [message_id]);
  return r.rows.length > 0;
}

async function markMessageProcessed(message_id) {
  if (!DATABASE_URL) return;
  await dbQuery(
    `INSERT INTO processed_messages (message_id) VALUES ($1)
     ON CONFLICT (message_id) DO NOTHING`,
    [message_id]
  );
}

async function cleanupProcessedMessages() {
  if (!DATABASE_URL) return;
  await dbQuery(`
    DELETE FROM processed_messages
    WHERE created_at < NOW() - INTERVAL '24 hours';
  `);
}

async function updateSession(wa_id, fields) {
  if (!DATABASE_URL) return;

  const allowed = ["temp_full_name", "temp_cedula", "temp_celular", "temp_correo", "step"];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));

  if (keys.length === 0) return;

  const setParts = keys.map((k, i) => `${k} = $${i + 2}`);
  setParts.push(`updated_at = NOW()`);

  const values = [wa_id, ...keys.map((k) => fields[k])];

  await dbQuery(
    `
    UPDATE sessions
    SET ${setParts.join(", ")}
    WHERE wa_id = $1
    `,
    values
  );
}

async function deleteSession(wa_id) {
  if (!DATABASE_URL) return;
  await dbQuery(`DELETE FROM sessions WHERE wa_id = $1`, [wa_id]);
}

async function upsertRegistration(wa_id, full_name, cedula, celular, correo) {
  if (!DATABASE_URL) return;

  await dbQuery(
    `
    INSERT INTO registrations (wa_id, full_name, cedula, celular, correo, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (wa_id)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      cedula = EXCLUDED.cedula,
      celular = EXCLUDED.celular,
      correo = EXCLUDED.correo,
      updated_at = NOW();
    `,
    [wa_id, full_name, cedula, celular, correo]
  );
}

// ====== Validaciones pro ======
function isValidEmail(email) {
  const e = (email || "").trim().toLowerCase();
  if (e.length > 254) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e);
}

function normalizeCOCell(input) {
  const digits = (input || "").replace(/\D/g, "");
  const d = digits.startsWith("57") ? digits.slice(2) : digits;
  if (!/^3\d{9}$/.test(d)) return null;
  return { national: d, e164: `+57${d}` };
}

// ====== MENÚ PRINCIPAL ======
async function sendMainMenu(to) {
  if (!TOKEN) return;

  const bodyText =
    "✨ *VIP Salud Ocupacional*\n\n" +
    "¡Hola! 👋\n" +
    "Bienvenido(a) al proceso del *Curso de Manipulación de Alimentos*.\n\n" +
    "A través de este chat podrás registrarte para realizar el curso y obtener tu certificado oficial.\n\n" +
    "Selecciona una opción para continuar:";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "registrarme", title: "📋 Registrarme" } },
          { type: "reply", reply: { id: "enlace", title: "🔗 Instructivo y link" } },
          { type: "reply", reply: { id: "asesor", title: "❓ Necesito ayuda" } },
        ],
      },
    },
  };

  await sendPayload(payload);
}

// ====== REGISTRO: INICIO ======
async function startRegistration(wa_id) {
  if (!DATABASE_URL) {
    await sendText(wa_id, "⚠️ En este momento el sistema de registro está en mantenimiento. Escríbenos y te ayudamos.");
    return;
  }

  await upsertSessionReset(wa_id);

  await sendText(
    wa_id,
    "📝 *Registro – Curso de Manipulación de Alimentos*\n\nPor favor escribe tu *Nombre y Apellido completo*."
  );
}

async function resendStepPrompt(wa_id, step) {
  if (step === "FULL_NAME") return sendText(wa_id, "📝 Escribe tu *Nombre y Apellido completo*.");
  if (step === "CEDULA") return sendText(wa_id, "Escribe tu *número de cédula* (solo números).");
  if (step === "CELULAR") return sendText(wa_id, "Escribe tu *celular* (10 dígitos, ej: 3001234567).");
  if (step === "CORREO") return sendText(wa_id, "Escribe tu *correo electrónico*.");
  if (step === "CONFIRM") return sendConfirmPrompt(wa_id);
  return startRegistration(wa_id);
}

// ====== REGISTRO: MANEJO DE PASOS ======
async function handleRegistrationStep(wa_id, step, text) {
  if (!DATABASE_URL) return;

  if (step === "FULL_NAME") {
    if ((text || "").length < 5) {
      return await sendText(wa_id, "Por favor escribe tu *nombre completo* (Nombre y Apellido).");
    }
    await updateSession(wa_id, { temp_full_name: text, step: "CEDULA" });
    return await sendText(wa_id, "Perfecto ✅ Ahora escribe tu *número de cédula* (solo números).");
  }

  if (step === "CEDULA") {
    const ced = (text || "").replace(/\D/g, "");
    if (ced.length < 5) {
      return await sendText(wa_id, "La cédula debe tener solo números. Escríbela nuevamente, por favor.");
    }

    // Validar duplicado de cédula (si ya existe con otro wa_id)
    const exists = await dbQuery(`SELECT wa_id FROM registrations WHERE cedula = $1`, [ced]);
    if (exists.rows.length > 0 && exists.rows[0].wa_id !== wa_id) {
      await deleteSession(wa_id);
      return await sendText(
        wa_id,
        "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*."
      );
    }

    await updateSession(wa_id, { temp_cedula: ced, step: "CELULAR" });
    return await sendText(wa_id, "Gracias ✅ Ahora escribe tu *número de celular* (ej: 3001234567).");
  }

  if (step === "CELULAR") {
    const norm = normalizeCOCell(text);
    if (!norm) {
      return await sendText(
        wa_id,
        "Celular inválido. Debe ser móvil colombiano (10 dígitos y empezar por 3). Ej: 3001234567"
      );
    }
    await updateSession(wa_id, { temp_celular: norm.e164, step: "CORREO" });
    return await sendText(wa_id, "Excelente ✅ Por último, escribe tu *correo electrónico*.");
  }

  if (step === "CORREO") {
    const correo = (text || "").trim().toLowerCase();
    if (!isValidEmail(correo)) {
      return await sendText(wa_id, "Ese correo no parece válido. Escríbelo nuevamente, por favor.");
    }

    await updateSession(wa_id, { temp_correo: correo, step: "CONFIRM" });
    return await sendConfirmPrompt(wa_id);
  }

  if (step === "CONFIRM") {
    // Si escribe algo en confirmación, lo guiamos:
    return await sendText(
      wa_id,
      "Por favor confirma tu registro usando los botones:\n✅ Confirmar o ✏️ Corregir\n\nTambién puedes escribir: *corregir*"
    );
  }

  await deleteSession(wa_id);
  return await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
}

// ====== Confirmación final ======
async function sendConfirmPrompt(to) {
  if (!DATABASE_URL) return;

  const session = await getSession(to);
  if (!session) {
    return await sendText(to, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
  }

  const summary =
    "✅ *Confirma tus datos*\n\n" +
    `👤 Nombre: *${session.temp_full_name || "-"}*\n` +
    `🪪 Cédula: *${session.temp_cedula || "-"}*\n` +
    `📱 Celular: *${session.temp_celular || "-"}*\n` +
    `📧 Correo: *${session.temp_correo || "-"}*\n\n` +
    "Si todo está correcto, presiona *✅ Confirmar*.\n" +
    "Si necesitas cambiar algo, presiona *✏️ Corregir*.";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: summary },
      action: {
        buttons: [
          { type: "reply", reply: { id: "confirm_reg", title: "✅ Confirmar" } },
          { type: "reply", reply: { id: "edit_reg", title: "✏️ Corregir" } },
        ],
      },
    },
  };

  await sendPayload(payload);
}

async function sendEditMenu(to) {
  if (!TOKEN) return;

  const bodyText =
    "✏️ *¿Qué dato deseas corregir?*\n\n" +
    "Selecciona una opción:";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "edit_name", title: "👤 Nombre" } },
          { type: "reply", reply: { id: "edit_cedula", title: "🪪 Cédula" } },
          { type: "reply", reply: { id: "edit_cell", title: "📱 Celular" } },
          { type: "reply", reply: { id: "edit_email", title: "📧 Correo" } },
        ],
      },
    },
  };

  await sendPayload(payload);

  // Nota: WhatsApp permite máx 3 botones por mensaje en muchos casos.
  // Para evitar errores de API, enviamos un segundo mensaje con "Volver al menú".
  const payload2 = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Opciones adicionales:" },
      action: {
        buttons: [{ type: "reply", reply: { id: "back_menu", title: "⬅️ Volver al menú" } }],
      },
    },
  };

  await sendPayload(payload2);
}

async function finalizeRegistration(wa_id) {
  if (!DATABASE_URL) return;

  const session = await getSession(wa_id);
  if (!session) {
    await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
    return;
  }

  // Validación final: que todo exista
  if (!session.temp_full_name || !session.temp_cedula || !session.temp_celular || !session.temp_correo) {
    await sendText(wa_id, "⚠️ Faltan datos por completar. Escribe *corregir* o presiona *📋 Registrarme*.");
    return;
  }

  // Validar duplicado de cédula (por seguridad)
  const exists = await dbQuery(`SELECT wa_id FROM registrations WHERE cedula = $1`, [session.temp_cedula]);
  if (exists.rows.length > 0 && exists.rows[0].wa_id !== wa_id) {
    await deleteSession(wa_id);
    await sendText(
      wa_id,
      "⚠️ Esta cédula ya aparece registrada en nuestro sistema.\n\nSi necesitas actualizar tus datos, escribe *Ayuda*."
    );
    return;
  }

  await upsertRegistration(wa_id, session.temp_full_name, session.temp_cedula, session.temp_celular, session.temp_correo);

  await deleteSession(wa_id);

  await sendText(
    wa_id,
    "✅ *Registro completado*\n\n¡Gracias! Tu información quedó registrada correctamente.\n\nAhora puedes ver el instructivo y el enlace del curso en el botón:\n🔗 *Instructivo y link*"
  );

  return await sendMainMenu(wa_id);
}

// ====== INSTRUCTIVO + LINK ======
async function sendCourseInfo(to) {
  const link = "https://www.curso.com"; // <-- CAMBIA por tu link real
  const password = "curso234"; // <-- si aplica

  const msg =
    "🎓 *Curso de Manipulación de Alimentos*\n\n" +
    "A continuación te compartimos el instructivo para iniciar tu capacitación:\n\n" +
    `1️⃣ Ingresa al siguiente enlace:\n${link}\n\n` +
    "2️⃣ Usuario: tu correo electrónico\n" +
    `🔐 Contraseña: ${password}\n\n` +
    "3️⃣ Una vez ingreses, haz clic en *INICIAR*.\n\n" +
    "4️⃣ Selecciona *Iniciar lección* y desarrolla toda la capacitación.\n\n" +
    "5️⃣ Al finalizar podrás descargar tu certificado, carnet y demás documentos.\n\n" +
    "Si presentas alguna dificultad durante el proceso, escríbenos y con gusto te ayudamos.\n" +
    "Quedamos atentos.";

  await sendText(to, msg);
}

// ====== Reintento inteligente (job) ======
async function nudgeAbandonedSessions() {
  if (!DATABASE_URL || !TOKEN) return;

  const r = await dbQuery(
    `
    SELECT wa_id, step, nudge_count, last_inbound_at, last_nudge_at
    FROM sessions
    WHERE
      nudge_count < $1
      AND last_inbound_at < NOW() - ($2 || ' minutes')::interval
      AND (last_nudge_at IS NULL OR last_nudge_at < NOW() - ($2 || ' minutes')::interval)
  `,
    [NUDGE_MAX, String(NUDGE_AFTER_MIN)]
  );

  for (const s of r.rows) {
    await sendContinuePrompt(s.wa_id);
    await dbQuery(
      `
      UPDATE sessions
      SET nudge_count = nudge_count + 1, last_nudge_at = NOW()
      WHERE wa_id = $1
    `,
      [s.wa_id]
    );
  }

  // expirar sesiones muy viejas
  await dbQuery(
    `
    DELETE FROM sessions
    WHERE last_inbound_at < NOW() - ($1 || ' minutes')::interval
  `,
    [String(SESSION_EXPIRE_MIN)]
  );
}

async function sendContinuePrompt(to) {
  const bodyText = "⏳ Notamos que no terminaste tu registro.\n\n¿Deseas continuar ahora?";

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "continue_reg", title: "✅ Continuar" } },
          { type: "reply", reply: { id: "cancel_reg", title: "❌ Cancelar" } },
        ],
      },
    },
  };

  await sendPayload(payload);
}

// ====== ENVIAR TEXTO ======
async function sendText(to, bodyText) {
  if (!TOKEN) return;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: bodyText },
  };

  await sendPayload(payload);
}

// ====== REQUEST A GRAPH API ======
async function sendPayload(payload) {
  try {
    const r = await fetch(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) console.error("❌ Error enviando mensaje:", r.status, data);
    else console.log("✅ Enviado OK");
  } catch (e) {
    console.error("❌ Fallo fetch a WhatsApp:", e);
  }
}

// ====== HEALTHCHECK ======
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// ====== START ======
(async () => {
  await initDb();

  // Job de nudges cada minuto (si hay DB y TOKEN)
  if (DATABASE_URL && TOKEN) {
    setInterval(() => nudgeAbandonedSessions().catch((e) => console.error("❌ Nudge error:", e)), NUDGE_CHECK_EVERY_MS);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Servidor activo en puerto ${PORT}. Webhook: /webhook`);
  });
})();

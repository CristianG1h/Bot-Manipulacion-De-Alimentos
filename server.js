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

if (!TOKEN) {
  console.warn("⚠️ Falta WHATSAPP_TOKEN. El bot recibirá webhooks pero NO podrá enviar mensajes.");
}

if (!DATABASE_URL) {
  console.warn("⚠️ Falta DATABASE_URL. El bot NO podrá guardar registros/sesiones en PostgreSQL.");
}

// ====== POSTGRES (Render) ======
const pool = new Pool({
  connectionString: DATABASE_URL,
  // Render Postgres usa SSL en la mayoría de casos:
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function dbQuery(text, params = []) {
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

    await dbQuery(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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

const messageId = msg.id;
if (messageId) {
  const already = await isProcessedMessage(messageId);
  if (already) {
    console.log("⏭️ Mensaje duplicado ignorado:", messageId);
    return;
  }
  await markMessageProcessed(messageId);
}

const now = Date.now();
if (now - lastCleanupAt > CLEANUP_EVERY_MS) {
  lastCleanupAt = now;
  cleanupProcessedMessages().catch((e) => console.error("❌ Cleanup error:", e));
}
      
const from = msg.from;

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

        return await sendMainMenu(from);
      }

      // Texto normal
      const text = (msg.text?.body || "").trim();

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

// ====== DB HELPERS (POSTGRES) ======
async function getSession(wa_id) {
  if (!DATABASE_URL) return null;

  const r = await dbQuery(`SELECT * FROM sessions WHERE wa_id = $1`, [wa_id]);
  return r.rows[0] || null;
}

async function upsertSessionReset(wa_id) {
  if (!DATABASE_URL) return;

  await dbQuery(
    `
    INSERT INTO sessions (wa_id, step, temp_full_name, temp_cedula, temp_celular, temp_correo, updated_at)
    VALUES ($1, 'FULL_NAME', NULL, NULL, NULL, NULL, NOW())
    ON CONFLICT (wa_id)
    DO UPDATE SET
      step = 'FULL_NAME',
      temp_full_name = NULL,
      temp_cedula = NULL,
      temp_celular = NULL,
      temp_correo = NULL,
      updated_at = NOW();
    `,
    [wa_id]
  );
}

async function isProcessedMessage(message_id) {
  const r = await dbQuery(`SELECT 1 FROM processed_messages WHERE message_id = $1`, [message_id]);
  return r.rows.length > 0;
}

async function markMessageProcessed(message_id) {
  // ON CONFLICT evita error si llega duplicado exacto
  await dbQuery(
    `INSERT INTO processed_messages (message_id) VALUES ($1)
     ON CONFLICT (message_id) DO NOTHING`,
    [message_id]
  );
}

async function cleanupProcessedMessages() {
  // Borra IDs con más de 24 horas
  await dbQuery(`
    DELETE FROM processed_messages
    WHERE created_at < NOW() - INTERVAL '24 hours';
  `);
}

async function updateSession(wa_id, fields) {
  if (!DATABASE_URL) return;

  // fields: { temp_full_name, temp_cedula, temp_celular, temp_correo, step }
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
    await sendText(
      wa_id,
      "⚠️ En este momento el sistema de registro está en mantenimiento. Escríbenos y te ayudamos."
    );
    return;
  }

  await upsertSessionReset(wa_id);

  await sendText(
    wa_id,
    "📝 *Registro – Curso de Manipulación de Alimentos*\n\nPor favor escribe tu *Nombre y Apellido completo*."
  );
}

// ====== REGISTRO: MANEJO DE PASOS ======
async function handleRegistrationStep(wa_id, step, text) {
  if (!DATABASE_URL) return;

  // Validaciones básicas (simples)
  if (step === "FULL_NAME") {
    if (text.length < 5) {
      return await sendText(wa_id, "Por favor escribe tu *nombre completo* (Nombre y Apellido).");
    }
    await updateSession(wa_id, { temp_full_name: text, step: "CEDULA" });
    return await sendText(wa_id, "Perfecto ✅ Ahora escribe tu *número de cédula* (solo números).");
  }

  if (step === "CEDULA") {
    const ced = text.replace(/\D/g, "");
    if (ced.length < 5) {
      return await sendText(wa_id, "La cédula debe tener solo números. Escríbela nuevamente, por favor.");
    }
    await updateSession(wa_id, { temp_cedula: ced, step: "CELULAR" });
    return await sendText(wa_id, "Gracias ✅ Ahora escribe tu *número de celular* (ej: 3XXXXXXXXX).");
  }

  if (step === "CELULAR") {
    const cel = text.replace(/\D/g, "");
    if (cel.length < 10) {
      return await sendText(wa_id, "Escríbeme el celular en formato de 10 dígitos (ej: 3001234567).");
    }
    await updateSession(wa_id, { temp_celular: cel, step: "CORREO" });
    return await sendText(wa_id, "Excelente ✅ Por último, escribe tu *correo electrónico*.");
  }

  if (step === "CORREO") {
    const correo = text.trim().toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
    if (!emailOk) {
      return await sendText(wa_id, "Ese correo no parece válido. Escríbelo nuevamente, por favor.");
    }

    const session = await getSession(wa_id);
    if (!session) {
      await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
      return;
    }

    await upsertRegistration(
      wa_id,
      session.temp_full_name,
      session.temp_cedula,
      session.temp_celular,
      correo
    );

    await deleteSession(wa_id);

    await sendText(
      wa_id,
      "✅ *Registro completado*\n\n¡Gracias! Tu información quedó registrada correctamente.\n\nAhora puedes ver el instructivo y el enlace del curso en el botón:\n🔗 *Instructivo y link*"
    );

    return await sendMainMenu(wa_id);
  }

  // Paso desconocido => reiniciar
  await deleteSession(wa_id);
  return await sendText(wa_id, "Se reinició el proceso. Por favor presiona *📋 Registrarme* nuevamente.");
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

// ====== HEALTHCHECK (opcional pero útil) ======
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// ====== START ======
(async () => {
  await initDb();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Servidor activo en puerto ${PORT}. Webhook: /webhook`);
  });

})();


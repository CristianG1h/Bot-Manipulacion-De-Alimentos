"use strict";

let Pool = null;

try {
  Pool = require("pg").Pool;
} catch {
  console.warn("⚠️ Paquete pg no instalado. Stats funcionará solo en memoria.");
}

const DATABASE_URL = process.env.DATABASE_URL;

const DEFAULT_STATS = {
  conversaciones: 0,
  mensajesRecibidos: 0,
  mensajesEnviados: 0,
  accesosEnviados: 0,
  certificadosEnviados: 0,
  asesoresActivados: 0,
  mensajesNoReconocidos: 0,
  duplicadosIgnorados: 0,
  rateLimitados: 0,
  erroresMeta: 0,

  ultimasInteracciones: [],

  keywords: {
    instructivo: 0,
    link: 0,
    hola: 0,
    certificado: 0,
    contraseña: 0,
    asesor: 0,
    recibido: 0,
    acceso: 0,
  },

  porHora: Array(24).fill(0),
  porDia: {},

  iniciadoEn: new Date().toISOString(),
};

function getDefaultStats() {
  return JSON.parse(JSON.stringify(DEFAULT_STATS));
}

let stats = getDefaultStats();

const usePostgres = Boolean(Pool && DATABASE_URL);

const pool = usePostgres
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
    })
  : null;

async function initDb() {
  if (!pool) {
    console.log("⚠️ Stats sin PostgreSQL. Funcionará solo en memoria.");
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_stats (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const result = await pool.query(
      "SELECT data FROM bot_stats WHERE id = $1 LIMIT 1",
      ["dashboard"]
    );

    if (result.rows.length > 0 && result.rows[0].data) {
      const saved = result.rows[0].data;
      const base = getDefaultStats();

      stats = {
        ...base,
        ...saved,
        keywords: {
          ...base.keywords,
          ...(saved.keywords || {}),
        },
        porHora:
          Array.isArray(saved.porHora) && saved.porHora.length === 24
            ? saved.porHora
            : Array(24).fill(0),
        porDia: saved.porDia || {},
        ultimasInteracciones: Array.isArray(saved.ultimasInteracciones)
          ? saved.ultimasInteracciones
          : [],
        iniciadoEn: saved.iniciadoEn || new Date().toISOString(),
      };

      console.log("✅ Estadísticas cargadas desde PostgreSQL");
    } else {
      await saveStatsNow();
      console.log("✅ Tabla de estadísticas creada en PostgreSQL");
    }
  } catch (error) {
    console.error("❌ Error inicializando estadísticas en PostgreSQL:", error.message);
  }
}

let saveTimer = null;

function saveStatsSoon() {
  if (!pool) return;

  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveStatsNow().catch((error) => {
      console.error("❌ Error guardando estadísticas:", error.message);
    });
  }, 500);
}

async function saveStatsNow() {
  if (!pool) return;

  await pool.query(
    `
    INSERT INTO bot_stats (id, data, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `,
    ["dashboard", stats]
  );
}

function fechaBogotaKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

function horaBogota(date = new Date()) {
  return date.toLocaleTimeString("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fechaBogotaLabel(date = new Date()) {
  return date.toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
  });
}

function maskPhone(value = "") {
  const s = String(value || "").replace(/\D/g, "");

  if (!s) return "sin número";

  return `${s.slice(0, 6)}***${s.slice(-2)}`;
}

function sumarDiaYHora(ahora = new Date()) {
  const hora = Number(
    ahora.toLocaleTimeString("es-CO", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      hour12: false,
    })
  );

  stats.porHora[hora] = (stats.porHora[hora] || 0) + 1;

  const key = fechaBogotaKey(ahora);
  stats.porDia[key] = (stats.porDia[key] || 0) + 1;

  const hace14 = Date.now() - 14 * 24 * 60 * 60 * 1000;

  for (const k of Object.keys(stats.porDia)) {
    const fecha = new Date(`${k}T00:00:00-05:00`).getTime();

    if (fecha < hace14) {
      delete stats.porDia[k];
    }
  }
}

function registrarInteraccion(tipo, detalle, estado = "ok") {
  const ahora = new Date();

  stats.ultimasInteracciones.unshift({
    hora: horaBogota(ahora),
    tipo,
    detalle: String(detalle || "").slice(0, 160),
    estado,
    ts: ahora.getTime(),
  });

  if (stats.ultimasInteracciones.length > 50) {
    stats.ultimasInteracciones = stats.ultimasInteracciones.slice(0, 50);
  }

  sumarDiaYHora(ahora);
  saveStatsSoon();
}

function sumarKeyword(key) {
  if (!key) return;

  stats.keywords[key] = (stats.keywords[key] || 0) + 1;
}

function actividadUltimos14Dias() {
  const dias = [];

  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);

    const key = fechaBogotaKey(d);

    dias.push({
      fecha: key,
      label: fechaBogotaLabel(d),
      total: stats.porDia[key] || 0,
    });
  }

  return dias;
}

const Stats = {
  mensajeRecibido(waId) {
    stats.mensajesRecibidos++;
    registrarInteraccion("mensaje_recibido", `Nuevo mensaje de ${maskPhone(waId)}`, "ok");
  },

  mensajeEnviado(tipo = "mensaje", detalle = "Mensaje enviado por WhatsApp") {
    stats.mensajesEnviados++;
    registrarInteraccion(tipo, detalle, "ok");
  },

  metaError(detalle = "Error enviando mensaje a Meta") {
    stats.erroresMeta++;
    registrarInteraccion("meta_error", detalle, "error");
  },

  menuEnviado(waId) {
    stats.conversaciones++;
    stats.mensajesEnviados++;
    sumarKeyword("hola");
    registrarInteraccion("menu", `Menú principal enviado a ${maskPhone(waId)}`, "ok");
  },

  instructivoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("instructivo");
    sumarKeyword("link");
    registrarInteraccion("instructivo", `Instructivo y link enviado a ${maskPhone(waId)}`, "ok");
  },

  recibidoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("recibido");
    registrarInteraccion("recibido", `Confirmación enviada a ${maskPhone(waId)}`, "ok");
  },

  asesorActivado(waId) {
    stats.mensajesEnviados++;
    stats.asesoresActivados++;
    sumarKeyword("asesor");
    registrarInteraccion("asesor", `Asesor activado para ${maskPhone(waId)}`, "asesor");
  },

  mensajeNoReconocido(waId, texto) {
    stats.mensajesNoReconocidos++;

    registrarInteraccion(
      "no_reconocido",
      `No reconocido de ${maskPhone(waId)}: "${String(texto || "").slice(0, 50)}"`,
      "warn"
    );
  },

  accesoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.accesosEnviados++;
    sumarKeyword("acceso");
    registrarInteraccion("acceso", `Acceso enviado a ${nombre}`, "ok");
  },

  certificadoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.certificadosEnviados++;
    sumarKeyword("certificado");
    registrarInteraccion("certificado", `Certificado enviado a ${nombre}`, "ok");
  },

  duplicadoIgnorado(id = "") {
    stats.duplicadosIgnorados++;
    registrarInteraccion("duplicado", `Duplicado ignorado ${id}`.trim(), "warn");
  },

  rateLimitado(waId) {
    stats.rateLimitados++;
    registrarInteraccion("rate_limit", `Rate limit para ${maskPhone(waId)}`, "warn");
  },

  getSnapshot() {
    return {
      totales: {
        conversaciones: stats.conversaciones,
        mensajesRecibidos: stats.mensajesRecibidos,
        mensajesEnviados: stats.mensajesEnviados,
        accesosEnviados: stats.accesosEnviados,
        certificadosEnviados: stats.certificadosEnviados,
        asesoresActivados: stats.asesoresActivados,
        mensajesNoReconocidos: stats.mensajesNoReconocidos,
        duplicadosIgnorados: stats.duplicadosIgnorados,
        rateLimitados: stats.rateLimitados,
        erroresMeta: stats.erroresMeta,
      },
      ultimasInteracciones: stats.ultimasInteracciones.slice(0, 20),
      keywords: stats.keywords,
      actividadPorDia: actividadUltimos14Dias(),
      actividadPorHora: stats.porHora,
      iniciadoEn: stats.iniciadoEn,
      uptime: Math.floor(process.uptime()),
      persistencia: pool ? "postgresql" : "memoria",
      zonaHoraria: "America/Bogota",
    };
  },
};

initDb();

module.exports = Stats;

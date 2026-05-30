"use strict";

let Pool = null;

try {
  Pool = require("pg").Pool;
} catch {
  console.warn("⚠️ Paquete pg no instalado. Stats funcionará solo en memoria.");
}

const DATABASE_URL = process.env.DATABASE_URL;
try {
  console.log("🔎 DATABASE_URL host:", DATABASE_URL ? new URL(DATABASE_URL).hostname : "sin DATABASE_URL");
} catch (e) {
  console.log("❌ DATABASE_URL inválida:", DATABASE_URL);
}

const DEFAULT_STATS = {
  contactosUnicos: [],

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_events (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        wa_id TEXT,
        wa_mask TEXT,
        tipo TEXT NOT NULL,
        detalle TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'ok',
        keywords TEXT[] DEFAULT '{}'
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bot_events_ts ON bot_events (ts DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bot_events_wa_id ON bot_events (wa_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_bot_events_tipo ON bot_events (tipo);
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
        contactosUnicos: Array.isArray(saved.contactosUnicos)
          ? saved.contactosUnicos
          : [],
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
      console.log("✅ Estadísticas iniciales creadas en PostgreSQL");
    }

    console.log("✅ Tabla bot_events lista para filtros");
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function normalizarWaId(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function maskPhone(value = "") {
  const s = normalizarWaId(value);

  if (!s) return "sin número";

  return `${s.slice(0, 6)}***${s.slice(-2)}`;
}

function registrarContactoUnico(waId) {
  const limpio = normalizarWaId(waId);

  if (!limpio) return;

  if (!Array.isArray(stats.contactosUnicos)) {
    stats.contactosUnicos = [];
  }

  if (!stats.contactosUnicos.includes(limpio)) {
    stats.contactosUnicos.push(limpio);
  }
}

function sumarDiaYHora(ahora = new Date()) {
  const horaTexto = ahora.toLocaleTimeString("es-CO", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    hour12: false,
  });

  const hora = Number(String(horaTexto).replace(/\D/g, ""));

  if (!Number.isNaN(hora) && hora >= 0 && hora <= 23) {
    stats.porHora[hora] = (stats.porHora[hora] || 0) + 1;
  }

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

function sumarKeyword(key) {
  if (!key) return;
  stats.keywords[key] = (stats.keywords[key] || 0) + 1;
}

function safeKeywords(arr = []) {
  return Array.from(
    new Set(
      arr
        .filter(Boolean)
        .map((x) => String(x).trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function registrarEventoDb({ waId, tipo, detalle, estado, keywords }) {
  if (!pool) return;

  const ahora = new Date();
  const waClean = normalizarWaId(waId);
  const fecha = fechaBogotaKey(ahora);
  const hora = horaBogota(ahora);
  const waMask = waClean ? maskPhone(waClean) : null;

  pool
    .query(
      `
      INSERT INTO bot_events (ts, fecha, hora, wa_id, wa_mask, tipo, detalle, estado, keywords)
      VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        fecha,
        hora,
        waClean || null,
        waMask,
        String(tipo || "evento"),
        String(detalle || "").slice(0, 250),
        String(estado || "ok"),
        safeKeywords(keywords),
      ]
    )
    .catch((error) => {
      console.error("❌ Error guardando evento en bot_events:", error.message);
    });
}

function registrarInteraccion({
  waId = "",
  tipo = "evento",
  detalle = "",
  estado = "ok",
  keywords = [],
}) {
  const ahora = new Date();

  stats.ultimasInteracciones.unshift({
  fecha: fechaBogotaKey(ahora),
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
  registrarEventoDb({ waId, tipo, detalle, estado, keywords });
  saveStatsSoon();
}

function actividadUltimos14DiasMemoria() {
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

function buildDateFilter(query = {}) {
  const range = String(query.range || "all");
  const from = String(query.from || "");
  const to = String(query.to || "");

  let start = null;
  let end = null;

  const now = new Date();

  if (range === "today") {
    const key = fechaBogotaKey(now);
    start = `${key}T00:00:00-05:00`;
    end = `${key}T23:59:59-05:00`;
  }

  if (range === "7d") {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    start = `${fechaBogotaKey(d)}T00:00:00-05:00`;
    end = `${fechaBogotaKey(now)}T23:59:59-05:00`;
  }

  if (range === "30d") {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    start = `${fechaBogotaKey(d)}T00:00:00-05:00`;
    end = `${fechaBogotaKey(now)}T23:59:59-05:00`;
  }

  if (range === "custom" && from && to) {
    start = `${from}T00:00:00-05:00`;
    end = `${to}T23:59:59-05:00`;
  }

  return { start, end, range };
}

function buildChartDateFilter(query = {}) {
  const range = String(query.chartRange || "14d");
  const offset = Number(query.chartOffset || 0);

  const now = new Date();

  let days = 14;

  if (range === "today") days = 1;
  if (range === "7d") days = 7;
  if (range === "14d") days = 14;
  if (range === "30d") days = 30;

  let start = null;
  let end = null;

  if (range === "custom" && query.chartFrom && query.chartTo) {
    start = `${query.chartFrom}T00:00:00-05:00`;
    end = `${query.chartTo}T23:59:59-05:00`;

    return {
      start,
      end,
      range,
      days: null,
      desde: query.chartFrom,
      hasta: query.chartTo,
    };
  }

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + offset * days);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));

  const startKey = fechaBogotaKey(startDate);
  const endKey = fechaBogotaKey(endDate);

  start = `${startKey}T00:00:00-05:00`;
  end = `${endKey}T23:59:59-05:00`;

  return {
    start,
    end,
    range,
    days,
    desde: startKey,
    hasta: endKey,
  };
}

function buildWhere(query = {}) {
  const params = [];
  const where = [];

  const { start, end } = buildDateFilter(query);

  if (start && end) {
    params.push(start);
    where.push(`ts >= $${params.length}`);

    params.push(end);
    where.push(`ts <= $${params.length}`);
  }

  const q = String(query.q || "").trim();

  if (q) {
    const qClean = q.replace(/\D/g, "");
    params.push(`%${q.toLowerCase()}%`);
    const pText = `$${params.length}`;

    if (qClean.length >= 4) {
      params.push(`%${qClean}%`);
      const pPhone = `$${params.length}`;

      where.push(`(
        LOWER(detalle) LIKE ${pText}
        OR LOWER(tipo) LIKE ${pText}
        OR LOWER(estado) LIKE ${pText}
        OR EXISTS (
          SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE ${pText}
        )
        OR wa_id LIKE ${pPhone}
      )`);
    } else {
      where.push(`(
        LOWER(detalle) LIKE ${pText}
        OR LOWER(tipo) LIKE ${pText}
        OR LOWER(estado) LIKE ${pText}
        OR EXISTS (
          SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE ${pText}
        )
      )`);
    }
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function buildChartWhere(query = {}) {
  const params = [];
  const where = [];

  const { start, end } = buildChartDateFilter(query);

  if (start && end) {
    params.push(start);
    where.push(`ts >= $${params.length}`);

    params.push(end);
    where.push(`ts <= $${params.length}`);
  }

  const q = String(query.q || "").trim();

  if (q) {
    const qClean = q.replace(/\D/g, "");
    params.push(`%${q.toLowerCase()}%`);
    const pText = `$${params.length}`;

    if (qClean.length >= 4) {
      params.push(`%${qClean}%`);
      const pPhone = `$${params.length}`;

      where.push(`(
        LOWER(detalle) LIKE ${pText}
        OR LOWER(tipo) LIKE ${pText}
        OR LOWER(estado) LIKE ${pText}
        OR EXISTS (
          SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE ${pText}
        )
        OR wa_id LIKE ${pPhone}
      )`);
    } else {
      where.push(`(
        LOWER(detalle) LIKE ${pText}
        OR LOWER(tipo) LIKE ${pText}
        OR LOWER(estado) LIKE ${pText}
        OR EXISTS (
          SELECT 1 FROM unnest(keywords) k WHERE LOWER(k) LIKE ${pText}
        )
      )`);
    }
  }

  return {
    sql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

async function getSnapshotPostgres(query = {}) {
  const { sql, params } = buildWhere(query);

  const totalsResult = await pool.query(
    `
    SELECT
      COUNT(DISTINCT wa_id) FILTER (WHERE wa_id IS NOT NULL AND tipo = 'mensaje_recibido')::int AS conversaciones,
      COUNT(*) FILTER (WHERE tipo = 'mensaje_recibido')::int AS mensajes_recibidos,
      COUNT(*) FILTER (WHERE tipo IN ('mensaje', 'whatsapp', 'menu', 'instructivo', 'recibido', 'asesor', 'acceso', 'certificado'))::int AS mensajes_enviados,
      COUNT(*) FILTER (WHERE tipo = 'acceso')::int AS accesos_enviados,
      COUNT(*) FILTER (WHERE tipo = 'certificado')::int AS certificados_enviados,
      COUNT(*) FILTER (WHERE tipo = 'asesor')::int AS asesores_activados,
      COUNT(*) FILTER (WHERE tipo = 'no_reconocido')::int AS mensajes_no_reconocidos,
      COUNT(*) FILTER (WHERE tipo = 'duplicado')::int AS duplicados_ignorados,
      COUNT(*) FILTER (WHERE tipo = 'rate_limit')::int AS rate_limitados,
      COUNT(*) FILTER (WHERE tipo = 'meta_error')::int AS errores_meta
    FROM bot_events
    ${sql}
    `,
    params
  );

  const t = totalsResult.rows[0] || {};

  const logsResult = await pool.query(
  `
  SELECT fecha, hora, tipo, detalle, estado, wa_mask, ts
  FROM bot_events
  ${sql}
  ORDER BY ts DESC
  LIMIT 50
  `,
  params
);

  const chartWhere = buildChartWhere(query);
const chartMeta = buildChartDateFilter(query);

const daysResult = await pool.query(
  `
  SELECT fecha, COUNT(*)::int AS total
  FROM bot_events
  ${chartWhere.sql}
  GROUP BY fecha
  ORDER BY fecha ASC
  `,
  chartWhere.params
);
  const daysMap = {};
  for (const row of daysResult.rows) {
    daysMap[row.fecha] = Number(row.total || 0);
  }

  const actividadPorDia = [];

const startDate = new Date(`${chartMeta.desde}T00:00:00-05:00`);
const endDate = new Date(`${chartMeta.hasta}T00:00:00-05:00`);

for (
  let d = new Date(startDate);
  d.getTime() <= endDate.getTime();
  d.setDate(d.getDate() + 1)
) {
  const key = fechaBogotaKey(d);

  actividadPorDia.push({
    fecha: key,
    label: fechaBogotaLabel(d),
    total: daysMap[key] || 0,
  });
}

  const keywordResult = await pool.query(
    `
    SELECT LOWER(k) AS keyword, COUNT(*)::int AS total
    FROM bot_events, unnest(keywords) AS k
    ${sql}
    GROUP BY LOWER(k)
    ORDER BY total DESC
    LIMIT 20
    `,
    params
  );

  const keywords = {
    instructivo: 0,
    link: 0,
    hola: 0,
    certificado: 0,
    contraseña: 0,
    asesor: 0,
    recibido: 0,
    acceso: 0,
  };

  for (const row of keywordResult.rows) {
    keywords[row.keyword] = Number(row.total || 0);
  }

  return {
    totales: {
      conversaciones: Number(t.conversaciones || 0),
      mensajesRecibidos: Number(t.mensajes_recibidos || 0),
      mensajesEnviados: Number(t.mensajes_enviados || 0),
      accesosEnviados: Number(t.accesos_enviados || 0),
      certificadosEnviados: Number(t.certificados_enviados || 0),
      asesoresActivados: Number(t.asesores_activados || 0),
      mensajesNoReconocidos: Number(t.mensajes_no_reconocidos || 0),
      duplicadosIgnorados: Number(t.duplicados_ignorados || 0),
      rateLimitados: Number(t.rate_limitados || 0),
      erroresMeta: Number(t.errores_meta || 0),
    },
    ultimasInteracciones: logsResult.rows.map((r) => ({
  fecha: r.fecha,
  hora: r.hora,
  tipo: r.tipo,
  detalle: r.detalle,
  estado: r.estado,
  wa_mask: r.wa_mask,
  ts: r.ts,
})),
    keywords,
    actividadPorDia,
    actividadPorHora: stats.porHora,
    iniciadoEn: stats.iniciadoEn,
    uptime: Math.floor(process.uptime()),
    persistencia: "postgresql",
    zonaHoraria: "America/Bogota",
    chartMeta: {
  range: chartMeta.range,
  desde: chartMeta.desde,
  hasta: chartMeta.hasta,
},

filtros: {
  q: query.q || "",
  range: query.range || "all",
  from: query.from || "",
  to: query.to || "",
  chartRange: query.chartRange || "14d",
  chartOffset: query.chartOffset || "0",
},
  };
}

function getSnapshotMemoria(query = {}) {
  const conversacionesReales = Array.isArray(stats.contactosUnicos)
    ? stats.contactosUnicos.length
    : 0;

  return {
    totales: {
      conversaciones: conversacionesReales,
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
    actividadPorDia: actividadUltimos14DiasMemoria(),
    actividadPorHora: stats.porHora,
    iniciadoEn: stats.iniciadoEn,
    uptime: Math.floor(process.uptime()),
    persistencia: "memoria",
    zonaHoraria: "America/Bogota",
    chartMeta: {
  range: chartMeta.range,
  desde: chartMeta.desde,
  hasta: chartMeta.hasta,
},

filtros: {
  q: query.q || "",
  range: query.range || "all",
  from: query.from || "",
  to: query.to || "",
  chartRange: query.chartRange || "14d",
  chartOffset: query.chartOffset || "0",
},
  };
}

const Stats = {
  mensajeRecibido(waId) {
    registrarContactoUnico(waId);
    stats.mensajesRecibidos++;

    registrarInteraccion({
      waId,
      tipo: "mensaje_recibido",
      detalle: `Nuevo mensaje de ${maskPhone(waId)}`,
      estado: "ok",
      keywords: [],
    });
  },

  mensajeEnviado(tipo = "mensaje", detalle = "Mensaje enviado por WhatsApp") {
    stats.mensajesEnviados++;

    registrarInteraccion({
      tipo,
      detalle,
      estado: "ok",
      keywords: [tipo],
    });
  },

  metaError(detalle = "Error enviando mensaje a Meta") {
    stats.erroresMeta++;

    registrarInteraccion({
      tipo: "meta_error",
      detalle,
      estado: "error",
      keywords: ["error", "meta"],
    });
  },

  menuEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("hola");

    registrarInteraccion({
      waId,
      tipo: "menu",
      detalle: `Menú principal enviado a ${maskPhone(waId)}`,
      estado: "ok",
      keywords: ["hola", "menu"],
    });
  },

  instructivoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("instructivo");
    sumarKeyword("link");

    registrarInteraccion({
      waId,
      tipo: "instructivo",
      detalle: `Instructivo y link enviado a ${maskPhone(waId)}`,
      estado: "ok",
      keywords: ["instructivo", "link", "curso"],
    });
  },

  recibidoEnviado(waId) {
    stats.mensajesEnviados++;
    sumarKeyword("recibido");

    registrarInteraccion({
      waId,
      tipo: "recibido",
      detalle: `Confirmación enviada a ${maskPhone(waId)}`,
      estado: "ok",
      keywords: ["recibido"],
    });
  },

  asesorActivado(waId) {
    stats.mensajesEnviados++;
    stats.asesoresActivados++;
    sumarKeyword("asesor");

    registrarInteraccion({
      waId,
      tipo: "asesor",
      detalle: `Asesor activado para ${maskPhone(waId)}`,
      estado: "asesor",
      keywords: ["asesor"],
    });
  },

  mensajeNoReconocido(waId, texto) {
    stats.mensajesNoReconocidos++;

    registrarInteraccion({
      waId,
      tipo: "no_reconocido",
      detalle: `No reconocido de ${maskPhone(waId)}: "${String(texto || "").slice(0, 50)}"`,
      estado: "warn",
      keywords: ["no_reconocido"],
    });
  },

  accesoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.accesosEnviados++;
    sumarKeyword("acceso");

    registrarInteraccion({
      tipo: "acceso",
      detalle: `Acceso enviado a ${nombre}`,
      estado: "ok",
      keywords: ["acceso"],
    });
  },

  certificadoEnviado(nombre = "usuario") {
    stats.mensajesEnviados++;
    stats.certificadosEnviados++;
    sumarKeyword("certificado");

    registrarInteraccion({
      tipo: "certificado",
      detalle: `Certificado enviado a ${nombre}`,
      estado: "ok",
      keywords: ["certificado"],
    });
  },

  duplicadoIgnorado(id = "") {
    stats.duplicadosIgnorados++;

    registrarInteraccion({
      tipo: "duplicado",
      detalle: `Duplicado ignorado ${id}`.trim(),
      estado: "warn",
      keywords: ["duplicado"],
    });
  },

  rateLimitado(waId) {
    stats.rateLimitados++;

    registrarInteraccion({
      waId,
      tipo: "rate_limit",
      detalle: `Rate limit para ${maskPhone(waId)}`,
      estado: "warn",
      keywords: ["rate_limit"],
    });
  },

  resetStats() {
    stats = getDefaultStats();
    saveStatsSoon();
  },

  async getSnapshot(query = {}) {
    if (pool) {
      return await getSnapshotPostgres(query);
    }

    return getSnapshotMemoria(query);
  },
};

initDb();

module.exports = Stats;
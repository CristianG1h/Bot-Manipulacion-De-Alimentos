"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const custodiaData = require("../data/custodia/clientes");

const DEFAULT_CLIENTES_URL =
  "https://vipso.biofile.com.co/InformeGerencial/Clientes.aspx";
const DEFAULT_LIST_ENDPOINT =
  "https://vipso.biofile.com.co/InformeGerencial/Clientes.aspx/Factura_AcuerdosComercialesLista";
const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_START_DELAY_SECONDS = 12;
const DEFAULT_MIN_ROWS = 100;

const staticSnapshot = Array.isArray(custodiaData.empresas)
  ? custodiaData.empresas.map((item) => ({ ...item }))
  : [];

let schedulerStarted = false;
let intervalHandle = null;
let initialHandle = null;
let syncPromise = null;

const state = {
  startedAt: null,
  running: false,
  lastReason: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastDurationMs: null,
  lastBiofileRows: 0,
  lastBiofileUnique: 0,
  lastCatalogSize: staticSnapshot.length,
  lastNewCount: 0,
  lastNewCompanies: [],
  lastFechaHasta: null,
  nextScheduledAt: null,
};

function envCredentials() {
  return {
    user: String(
      process.env.BIOFILE_USER || process.env.BIOFILE_USUARIO || ""
    ).trim(),
    password: String(
      process.env.BIOFILE_PASSWORD || process.env.BIOFILE_CONTRASENA || ""
    ),
  };
}

function clientesUrl() {
  return String(
    process.env.BIOFILE_CLIENTES_URL || DEFAULT_CLIENTES_URL
  ).trim();
}

function listEndpoint() {
  return String(
    process.env.BIOFILE_CLIENTES_ENDPOINT || DEFAULT_LIST_ENDPOINT
  ).trim();
}

function intervalMs() {
  const hours = Number(
    process.env.BIOFILE_SYNC_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS
  );
  return Math.max(1, Number.isFinite(hours) ? hours : DEFAULT_INTERVAL_HOURS) *
    60 * 60 * 1000;
}

function startDelayMs() {
  const seconds = Number(
    process.env.BIOFILE_SYNC_START_DELAY_SECONDS || DEFAULT_START_DELAY_SECONDS
  );
  return Math.max(
    1,
    Number.isFinite(seconds) ? seconds : DEFAULT_START_DELAY_SECONDS
  ) * 1000;
}

function minRows() {
  const value = Number(process.env.BIOFILE_SYNC_MIN_ROWS || DEFAULT_MIN_ROWS);
  return Math.max(10, Number.isFinite(value) ? value : DEFAULT_MIN_ROWS);
}

function normalizeDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeName(value) {
  return String(value ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDv(value) {
  if (value === 0 || value === "0") return "0";
  return String(value ?? "").replace(/\D/g, "").trim();
}

function companyKey(company) {
  return `${normalizeDigits(company?.nit)}|${normalizeName(company?.nombre)}`;
}

function dedupeCompanies(list) {
  const seen = new Set();
  const output = [];

  for (const company of list || []) {
    const nit = normalizeDigits(company?.nit);
    const nombre = String(company?.nombre || "").replace(/\s+/g, " ").trim();
    if (!nit || !nombre) continue;

    const normalized = {
      ...company,
      nombre,
      nit,
      dv: normalizeDv(company?.dv),
    };
    const key = companyKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return value;
  }
}

function extractRowsFromResponse(raw) {
  let current = parseMaybeJson(raw);

  for (let i = 0; i < 5; i += 1) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      if (Object.prototype.hasOwnProperty.call(current, "d")) {
        current = parseMaybeJson(current.d);
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, "Datos")) {
        const datos = parseMaybeJson(current.Datos);
        if (Array.isArray(datos)) return datos;
        current = datos;
        continue;
      }
    }
    break;
  }

  if (Array.isArray(current)) return current;
  throw new Error("BIOFILE respondió, pero no se encontró el arreglo Datos");
}

function rowValue(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
      return row[key];
    }
  }
  return "";
}

function mapBiofileRows(rows) {
  const mapped = (rows || []).map((row) => {
    const nombre = String(
      rowValue(row, [
        "Nombre del Acuerdo Comercial, Contrato o Convenio",
        "NombreAcuerdoComercial",
        "Nombre del Cliente",
        "Nombre",
      ])
    )
      .replace(/\s+/g, " ")
      .trim();

    const nit = normalizeDigits(
      rowValue(row, [
        "N° de Identificación del Cliente",
        "Nº de Identificación del Cliente",
        "NumeroIdentificacionCliente",
        "NIT",
        "Nit",
      ])
    );

    return {
      nombre,
      nit,
      dv: normalizeDv(rowValue(row, ["Dv", "DV", "dv"])),
      tipo: String(rowValue(row, ["Tipo", "tipo"]) || "").trim(),
      fechaCreacion: String(
        rowValue(row, ["Fecha de Creación", "FechaCreacion"]) || ""
      ).trim(),
      usuarioCreacion: String(
        rowValue(row, ["Usuario Creación", "UsuarioCreacion"]) || ""
      ).trim(),
      fuente: "BIOFILE",
    };
  });

  return dedupeCompanies(mapped.filter((item) => item.nit.length >= 6));
}

function bogotaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year}`;
}

function responseFinalUrl(response, fallback = "") {
  return String(response?.request?.res?.responseUrl || fallback || "");
}

function htmlLooksLikeLogin(html, url = "") {
  if (/IniciarSesion/i.test(String(url || ""))) return true;
  try {
    const $ = cheerio.load(String(html || ""));
    return $("input[type='password']").length > 0;
  } catch (_) {
    return false;
  }
}

function createHttpClient() {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: Number(process.env.BIOFILE_HTTP_TIMEOUT_MS || 30000),
      maxRedirects: 8,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/json,text/javascript;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
      },
    })
  );
}

function buildLoginPayload(html, finalUrl, user, password) {
  const $ = cheerio.load(String(html || ""));
  const form = $("form").first();
  if (!form.length) {
    throw new Error("No se encontró el formulario de inicio de sesión de BIOFILE");
  }

  const payload = {};
  form.find("input").each((_, input) => {
    const name = $(input).attr("name");
    if (!name) return;
    const type = String($(input).attr("type") || "text").toLowerCase();
    if (["checkbox", "radio", "file"].includes(type)) return;
    payload[name] = $(input).attr("value") || "";
  });

  const inputs = form.find("input").toArray();
  const userInput = inputs.find((input) => {
    const type = String($(input).attr("type") || "text").toLowerCase();
    return ["text", "email"].includes(type) && Boolean($(input).attr("name"));
  });
  const passwordInput = inputs.find((input) => {
    const type = String($(input).attr("type") || "").toLowerCase();
    return type === "password" && Boolean($(input).attr("name"));
  });

  if (!userInput || !passwordInput) {
    throw new Error("No se identificaron los campos de usuario y contraseña de BIOFILE");
  }

  payload[$(userInput).attr("name")] = user;
  payload[$(passwordInput).attr("name")] = password;

  const submitCandidates = form.find("input[type='submit'],button").toArray();
  const preferredSubmit =
    submitCandidates.find((element) => {
      const text = String(
        $(element).attr("value") || $(element).text() || ""
      ).trim();
      return /ingresar|iniciar|entrar/i.test(text);
    }) || submitCandidates[0];

  if (preferredSubmit) {
    const name = $(preferredSubmit).attr("name");
    if (name) {
      payload[name] =
        $(preferredSubmit).attr("value") ||
        $(preferredSubmit).text().trim() ||
        "Ingresar al sistema";
    }
  }

  const action = new URL(
    form.attr("action") || finalUrl || clientesUrl(),
    finalUrl || clientesUrl()
  ).href;

  return { action, payload };
}

async function ensureLogin(client) {
  const { user, password } = envCredentials();
  if (!user || !password) {
    throw new Error(
      "Faltan BIOFILE_USER y BIOFILE_PASSWORD en las variables de entorno"
    );
  }

  let response = await client.get(clientesUrl());
  let finalUrl = responseFinalUrl(response, clientesUrl());

  if (!htmlLooksLikeLogin(response.data, finalUrl)) {
    return response;
  }

  const login = buildLoginPayload(response.data, finalUrl, user, password);
  response = await client.post(
    login.action,
    new URLSearchParams(login.payload).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: finalUrl,
      },
    }
  );

  finalUrl = responseFinalUrl(response, login.action);
  if (htmlLooksLikeLogin(response.data, finalUrl)) {
    throw new Error(
      "BIOFILE no aceptó el inicio de sesión. Revisa usuario, contraseña o una validación adicional."
    );
  }

  response = await client.get(clientesUrl());
  finalUrl = responseFinalUrl(response, clientesUrl());
  if (htmlLooksLikeLogin(response.data, finalUrl)) {
    throw new Error("La sesión de BIOFILE no quedó activa después del login");
  }

  return response;
}

async function fetchBiofileCompanies() {
  const client = createHttpClient();
  await ensureLogin(client);

  const fechaHasta = bogotaDateString();
  const payload = {
    NombreAcuerdoComercial: "",
    NumeroIdentificacionCliente: "",
    Nombre: "",
    FechaDesde: "",
    FechaHasta: fechaHasta,
  };

  const response = await client.post(listEndpoint(), payload, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/json; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: clientesUrl(),
    },
  });

  const rows = extractRowsFromResponse(response.data);
  const companies = mapBiofileRows(rows);

  if (rows.length < minRows() || companies.length < minRows()) {
    throw new Error(
      `BIOFILE devolvió pocos registros (${rows.length} filas / ${companies.length} empresas únicas); se conserva el catálogo anterior por seguridad.`
    );
  }

  return { rows, companies, fechaHasta };
}

function applyCompanies(remoteCompanies) {
  const target = custodiaData.empresas;
  if (!Array.isArray(target)) {
    throw new Error("El catálogo de custodia no es un arreglo mutable");
  }

  const before = dedupeCompanies(target);
  const beforeKeys = new Set(before.map(companyKey));

  // BIOFILE va primero para que, si un NIT/nombre ya existía, prevalezcan
  // sus datos más recientes (por ejemplo, un DV corregido).
  const merged = dedupeCompanies([
    ...remoteCompanies,
    ...before,
    ...staticSnapshot,
  ]);

  const added = merged.filter((company) => !beforeKeys.has(companyKey(company)));

  target.splice(0, target.length, ...merged);

  return {
    beforeCount: before.length,
    afterCount: merged.length,
    newCount: added.length,
    newCompanies: added.slice(0, 15).map((company) => ({
      nombre: company.nombre,
      nit: company.nit,
      dv: company.dv,
    })),
  };
}

async function syncCustodiaCompanies({ reason = "manual" } = {}) {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const started = Date.now();
    state.running = true;
    state.lastReason = reason;
    state.lastAttemptAt = new Date(started).toISOString();
    state.lastError = null;

    try {
      const fetched = await fetchBiofileCompanies();
      const applied = applyCompanies(fetched.companies);

      state.lastSuccessAt = new Date().toISOString();
      state.lastDurationMs = Date.now() - started;
      state.lastBiofileRows = fetched.rows.length;
      state.lastBiofileUnique = fetched.companies.length;
      state.lastCatalogSize = applied.afterCount;
      state.lastNewCount = applied.newCount;
      state.lastNewCompanies = applied.newCompanies;
      state.lastFechaHasta = fetched.fechaHasta;

      console.log(
        `✅ Custodia BIOFILE sincronizada: ${fetched.rows.length} filas, ` +
          `${fetched.companies.length} únicas, catálogo ${applied.afterCount}, ` +
          `nuevas ${applied.newCount}, ${state.lastDurationMs} ms.`
      );

      if (applied.newCompanies.length) {
        console.log(
          "🆕 Empresas nuevas de custodia:",
          applied.newCompanies
            .map((item) => `${item.nombre} (${item.nit}-${item.dv || "?"})`)
            .join(" | ")
        );
      }

      return {
        ok: true,
        reason,
        ...applied,
        biofileRows: fetched.rows.length,
        biofileUnique: fetched.companies.length,
        fechaHasta: fetched.fechaHasta,
        durationMs: state.lastDurationMs,
      };
    } catch (error) {
      state.lastDurationMs = Date.now() - started;
      state.lastError = String(error?.message || error);
      console.error(
        `❌ Sincronización Custodia BIOFILE falló (${reason}):`,
        state.lastError
      );
      throw error;
    } finally {
      state.running = false;
    }
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

function getCustodiaSyncStatus() {
  const credentials = envCredentials();
  return {
    ok: true,
    schedulerStarted,
    credentialsConfigured: Boolean(credentials.user && credentials.password),
    intervalHours: intervalMs() / (60 * 60 * 1000),
    startDelaySeconds: startDelayMs() / 1000,
    clientesUrl: clientesUrl(),
    catalogSize: Array.isArray(custodiaData.empresas)
      ? custodiaData.empresas.length
      : 0,
    staticCatalogSize: staticSnapshot.length,
    ...state,
  };
}

function startCustodiaBiofileSync() {
  if (schedulerStarted) return getCustodiaSyncStatus();
  schedulerStarted = true;
  state.startedAt = new Date().toISOString();

  const everyMs = intervalMs();
  const delayMs = startDelayMs();
  state.nextScheduledAt = new Date(Date.now() + delayMs).toISOString();

  const run = async (reason) => {
    try {
      await syncCustodiaCompanies({ reason });
    } catch (_) {
      // El catálogo embebido permanece disponible si BIOFILE no responde.
    } finally {
      state.nextScheduledAt = new Date(Date.now() + everyMs).toISOString();
    }
  };

  initialHandle = setTimeout(() => run("startup"), delayMs);
  initialHandle.unref?.();

  intervalHandle = setInterval(() => run("24h"), everyMs);
  intervalHandle.unref?.();

  const credentials = envCredentials();
  if (!credentials.user || !credentials.password) {
    console.warn(
      "⚠️ Sincronización Custodia BIOFILE preparada, pero faltan BIOFILE_USER/BIOFILE_PASSWORD. " +
        "El catálogo estático seguirá funcionando hasta que Render reinicie con esas variables."
    );
  } else {
    console.log(
      `🔄 Custodia BIOFILE: sincronización inicial en ${Math.round(
        delayMs / 1000
      )} s y luego cada ${everyMs / (60 * 60 * 1000)} h.`
    );
  }

  return getCustodiaSyncStatus();
}

function stopCustodiaBiofileSync() {
  if (initialHandle) clearTimeout(initialHandle);
  if (intervalHandle) clearInterval(intervalHandle);
  initialHandle = null;
  intervalHandle = null;
  schedulerStarted = false;
  state.nextScheduledAt = null;
}

module.exports = {
  normalizeDigits,
  normalizeName,
  extractRowsFromResponse,
  mapBiofileRows,
  bogotaDateString,
  applyCompanies,
  fetchBiofileCompanies,
  syncCustodiaCompanies,
  getCustodiaSyncStatus,
  startCustodiaBiofileSync,
  stopCustodiaBiofileSync,
};

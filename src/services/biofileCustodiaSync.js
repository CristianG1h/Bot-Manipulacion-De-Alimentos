"use strict";

const puppeteer = require("puppeteer");
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
  lastLoginMode: null,
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

  for (let i = 0; i < 6; i += 1) {
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

async function isLoginPage(page) {
  if (/IniciarSesion/i.test(page.url())) return true;
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  });
}

async function submitLogin(page, user, password) {
  const navigation = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12000 })
    .catch(() => null);

  const result = await page.evaluate(
    ({ userValue, passwordValue }) => {
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const setNativeValue = (input, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        );
        if (descriptor?.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const inputs = Array.from(document.querySelectorAll("input")).filter(visible);
      const passwordInput = inputs.find(
        (input) => String(input.type || "").toLowerCase() === "password"
      );
      const userInput = inputs.find((input) => {
        const type = String(input.type || "text").toLowerCase();
        return input !== passwordInput && ["text", "email"].includes(type);
      });

      if (!userInput || !passwordInput) {
        return { ok: false, error: "No se encontraron los campos visibles de acceso" };
      }

      setNativeValue(userInput, userValue);
      setNativeValue(passwordInput, passwordValue);

      const candidates = Array.from(
        document.querySelectorAll('button,input[type="submit"],input[type="button"],a')
      ).filter(visible);

      const button =
        candidates.find((element) => {
          const text = String(
            element.innerText || element.value || element.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim();
          return /ingresar\s+al\s+sistema|ingresar|iniciar\s+sesi[oó]n|acceder/i.test(text);
        }) || candidates.find((element) => element.tagName === "BUTTON") || candidates[0];

      if (!button) {
        return { ok: false, error: "No se encontró el botón de ingreso" };
      }

      button.click();
      return { ok: true };
    },
    { userValue: user, passwordValue: password }
  );

  if (!result?.ok) {
    throw new Error(result?.error || "No fue posible completar el formulario de login");
  }

  await navigation;
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

async function launchBrowser() {
  const executablePath = puppeteer.executablePath();
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
    ],
  });
}

async function fetchBiofileCompanies() {
  const { user, password } = envCredentials();
  if (!user || !password) {
    throw new Error(
      "Faltan BIOFILE_USER y BIOFILE_PASSWORD en las variables de entorno"
    );
  }

  const browser = await launchBrowser();
  let page = null;

  try {
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(
      Number(process.env.BIOFILE_BROWSER_NAV_TIMEOUT_MS || 30000)
    );
    page.setDefaultTimeout(
      Number(process.env.BIOFILE_BROWSER_ACTION_TIMEOUT_MS || 15000)
    );

    await page.goto(clientesUrl(), {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.BIOFILE_BROWSER_NAV_TIMEOUT_MS || 30000),
    });

    if (await isLoginPage(page)) {
      state.lastLoginMode = "browser-form";
      console.log("🔐 Custodia BIOFILE: iniciando sesión mediante el formulario web.");
      await submitLogin(page, user, password);
    } else {
      state.lastLoginMode = "existing-session";
    }

    // Entrar expresamente a Clientes.aspx después del login. Esto reproduce
    // el flujo manual y garantiza que la llamada AJAX se haga con la sesión
    // y las cookies reales de BIOFILE.
    await page.goto(clientesUrl(), {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.BIOFILE_BROWSER_NAV_TIMEOUT_MS || 30000),
    });

    if (await isLoginPage(page)) {
      throw new Error(
        "BIOFILE volvió a mostrar la pantalla de acceso después de enviar el formulario."
      );
    }

    const fechaHasta = bogotaDateString();
    const payload = {
      NombreAcuerdoComercial: "",
      NumeroIdentificacionCliente: "",
      Nombre: "",
      FechaDesde: "",
      FechaHasta: fechaHasta,
    };

    const response = await page.evaluate(
      async ({ endpoint, body }) => {
        const result = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(body),
        });

        return {
          ok: result.ok,
          status: result.status,
          url: result.url,
          text: await result.text(),
        };
      },
      { endpoint: listEndpoint(), body: payload }
    );

    if (!response?.ok) {
      throw new Error(
        `La consulta de empresas de BIOFILE respondió HTTP ${response?.status || "desconocido"}`
      );
    }

    if (/IniciarSesion/i.test(String(response.url || ""))) {
      throw new Error("La sesión de BIOFILE expiró antes de consultar las empresas");
    }

    const rows = extractRowsFromResponse(response.text);
    const companies = mapBiofileRows(rows);

    if (rows.length < minRows() || companies.length < minRows()) {
      throw new Error(
        `BIOFILE devolvió pocos registros (${rows.length} filas / ${companies.length} empresas únicas); se conserva el catálogo anterior por seguridad.`
      );
    }

    return { rows, companies, fechaHasta };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_) {
      }
    }
    try {
      await browser.close();
    } catch (_) {
    }
  }
}

function applyCompanies(remoteCompanies) {
  const target = custodiaData.empresas;
  if (!Array.isArray(target)) {
    throw new Error("El catálogo de custodia no es un arreglo mutable");
  }

  const before = dedupeCompanies(target);
  const beforeKeys = new Set(before.map(companyKey));

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
      // Si BIOFILE falla, el catálogo embebido sigue disponible.
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

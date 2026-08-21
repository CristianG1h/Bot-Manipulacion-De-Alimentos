"use strict";

const fs = require("fs");

let browserPromise = null;
let shuttingDown = false;

// Render Free tiene recursos limitados. Una sola página concurrente evita
// picos de memoria al generar certificados simultáneamente.
const MAX_PAGES = Math.max(1, Number(process.env.PDF_BROWSER_CONCURRENCY || 1));
let activePages = 0;
const waiters = [];

async function acquireSlot() {
  if (activePages < MAX_PAGES) {
    activePages += 1;
    return;
  }
  await new Promise((resolve) => waiters.push(resolve));
  activePages += 1;
}

function releaseSlot() {
  activePages = Math.max(0, activePages - 1);
  const next = waiters.shift();
  if (next) next();
}

function resolveExecutablePath(puppeteer) {
  const explicit = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {
  }

  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Chrome/Chromium no está disponible. El build debe ejecutar `npx puppeteer browsers install chrome`."
  );
}

async function getBrowser() {
  if (shuttingDown) throw new Error("Navegador PDF cerrándose");

  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = require("puppeteer");
      const executablePath = resolveExecutablePath(puppeteer);

      console.log("🖨️ Motor PDF Chrome listo:", executablePath);

      const browser = await puppeteer.launch({
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

      browser.on("disconnected", () => {
        browserPromise = null;
      });

      return browser;
    })().catch((error) => {
      browserPromise = null;
      console.error("❌ No se pudo iniciar Chrome para PDF:", error.message);
      throw error;
    });
  }

  return browserPromise;
}

async function withPage(fn) {
  await acquireSlot();
  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(
      Number(process.env.PDF_NAV_TIMEOUT_MS || 30000)
    );
    page.setDefaultTimeout(
      Number(process.env.PDF_ACTION_TIMEOUT_MS || 15000)
    );

    return await fn(page);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_) {
      }
    }
    releaseSlot();
  }
}

async function waitForFonts(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (_) {
      }
    }
  });
}

async function waitForImages(page, maxWaitMs = 3000) {
  await page.evaluate(async (timeoutMs) => {
    const images = Array.from(document.images || []);
    const waiting = images.map((img) => {
      if (img.complete) return Promise.resolve();

      return new Promise((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    });

    await Promise.race([
      Promise.all(waiting),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }, Math.max(250, Number(maxWaitMs) || 3000));
}

async function renderUrlToPdf(url) {
  return withPage(async (page) => {
    const response = await page.goto(String(url), {
      waitUntil: "networkidle2",
    });

    if (!response) {
      throw new Error("La página del certificado no respondió");
    }

    const status = response.status();
    if (status >= 400) {
      throw new Error(`La página del certificado respondió HTTP ${status}`);
    }

    await page.emulateMediaType("print");
    await waitForFonts(page);
    await waitForImages(page);

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return Buffer.from(pdf);
  });
}

async function renderHtmlToPdf(html) {
  return withPage(async (page) => {
    // Custodia usa un HTML autocontenido: no consulta URLs ni recursos externos.
    // Esperar networkidle0 podía bloquear el render hasta 30 s en Render.
    await page.setContent(String(html || ""), {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.PDF_HTML_LOAD_TIMEOUT_MS || 8000),
    });

    await page.emulateMediaType("print");
    await waitForFonts(page);
    await waitForImages(
      page,
      Number(process.env.PDF_IMAGE_WAIT_MS || 3000)
    );

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return Buffer.from(pdf);
  });
}

async function shutdownBrowser() {
  shuttingDown = true;

  if (!browserPromise) return;

  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (_) {
  } finally {
    browserPromise = null;
  }
}

process.once("SIGTERM", shutdownBrowser);
process.once("SIGINT", shutdownBrowser);

module.exports = {
  renderUrlToPdf,
  renderHtmlToPdf,
  shutdownBrowser,
};

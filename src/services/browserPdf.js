"use strict";

let browserPromise = null;
let shuttingDown = false;

const MAX_PAGES = Math.max(1, Number(process.env.PDF_BROWSER_CONCURRENCY || 2));
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

async function getBrowser() {
  if (shuttingDown) throw new Error("Navegador PDF cerrándose");

  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = require("puppeteer");
      const launchOptions = {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
        ],
      };

      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      const browser = await puppeteer.launch(launchOptions);
      browser.on("disconnected", () => { browserPromise = null; });
      return browser;
    })().catch((error) => {
      browserPromise = null;
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
    page.setDefaultNavigationTimeout(Number(process.env.PDF_NAV_TIMEOUT_MS || 30000));
    page.setDefaultTimeout(Number(process.env.PDF_ACTION_TIMEOUT_MS || 15000));
    return await fn(page);
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
    releaseSlot();
  }
}

async function renderUrlToPdf(url) {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: "networkidle2" });
    await page.emulateMediaType("print");
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch (_) {}
      }
    });

    return Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
  });
}

async function renderHtmlToPdf(html) {
  return withPage(async (page) => {
    await page.setContent(String(html || ""), { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch (_) {}
      }
    });

    return Buffer.from(await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }));
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

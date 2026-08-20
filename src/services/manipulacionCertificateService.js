"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const { findStudent, normalizeDocument } = require("./certificadosBotService");
const { renderUrlToPdf } = require("./browserPdf");

const MAX_PDF_BYTES = Number(
  process.env.CERTIFICATE_MAX_PDF_BYTES || 12 * 1024 * 1024
);

function assertSafeHttpUrl(rawUrl) {
  const url = new URL(String(rawUrl || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL de certificado no permitida");
  }
  return url;
}

function sameOrigin(base, candidate) {
  return base.origin === candidate.origin;
}

function validPdf(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length > 5 &&
    buffer.subarray(0, 5).toString() === "%PDF-";
}

async function downloadPdfIfDirect(rawUrl) {
  const url = assertSafeHttpUrl(rawUrl);

  const response = await axios.get(url.href, {
    timeout: 20000,
    maxRedirects: 5,
    responseType: "arraybuffer",
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      Accept: "application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
  });

  const contentType = String(
    response.headers["content-type"] || ""
  ).toLowerCase();
  const body = Buffer.from(response.data);

  if (contentType.includes("application/pdf") || validPdf(body)) {
    if (body.length > MAX_PDF_BYTES) {
      throw new Error("PDF demasiado grande");
    }
    return body;
  }

  if (!contentType.includes("html")) return null;

  const html = body.toString("utf8");
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href],iframe[src],embed[src],object[data]").each((_, el) => {
    const raw =
      $(el).attr("href") ||
      $(el).attr("src") ||
      $(el).attr("data") ||
      "";

    if (
      raw &&
      (/\.pdf(?:$|[?#])/i.test(raw) || /(?:download|pdf)/i.test(raw))
    ) {
      candidates.push(raw);
    }
  });

  for (const raw of candidates.slice(0, 8)) {
    try {
      const candidate = new URL(raw, url);
      if (!sameOrigin(url, candidate)) continue;

      const pdfResponse = await axios.get(candidate.href, {
        timeout: 15000,
        maxRedirects: 5,
        responseType: "arraybuffer",
        validateStatus: (status) => status >= 200 && status < 400,
        headers: {
          Referer: url.href,
          Accept: "application/pdf,*/*;q=0.8",
        },
      });

      const pdf = Buffer.from(pdfResponse.data);
      const type = String(
        pdfResponse.headers["content-type"] || ""
      ).toLowerCase();

      if (type.includes("application/pdf") || validPdf(pdf)) {
        if (pdf.length > MAX_PDF_BYTES) {
          throw new Error("PDF demasiado grande");
        }
        return pdf;
      }
    } catch (_) {
    }
  }

  return null;
}

async function renderCertificatePage(url) {
  let lastError = null;

  // Un segundo intento cubre arranques fríos de Chrome o una navegación
  // transitoria sin duplicar consultas al panel administrativo.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const pdf = await renderUrlToPdf(url);
      if (validPdf(pdf)) return pdf;
      lastError = new Error("Chrome devolvió un archivo que no es PDF");
    } catch (error) {
      lastError = error;
      console.warn(
        `⚠️ Render PDF Manipulación intento ${attempt}/2:`,
        error.message
      );
    }
  }

  throw lastError || new Error("No se pudo renderizar el certificado");
}

async function buildManipulationCertificate(documentValue) {
  const documento = normalizeDocument(documentValue);
  const student = await findStudent(documento);

  if (!student) {
    return { found: false, documento };
  }

  if (!student.completado && !student.certificado_url) {
    return {
      found: true,
      available: false,
      student,
      reason:
        "El estudiante existe, pero todavía no aparece un certificado disponible.",
    };
  }

  const urls = [student.certificado_url, student.verification_url]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  if (!urls.length) {
    throw new Error("El estudiante no tiene URL de certificado disponible");
  }

  let pdfBuffer = null;
  const errors = [];

  // Camino rápido: si la plataforma ofrece PDF directo, no se abre Chrome.
  for (const url of urls) {
    try {
      pdfBuffer = await downloadPdfIfDirect(url);
      if (validPdf(pdfBuffer)) break;
    } catch (error) {
      errors.push(`directo: ${error.message}`);
      console.warn("⚠️ Descarga PDF directa no disponible:", error.message);
    }
  }

  // La pantalla pública actual es HTML. En ese caso se imprime con Chrome
  // headless, instalado explícitamente durante el build de Render.
  if (!validPdf(pdfBuffer)) {
    for (const url of urls) {
      try {
        pdfBuffer = await renderCertificatePage(url);
        if (validPdf(pdfBuffer)) break;
      } catch (error) {
        errors.push(`chrome: ${error.message}`);
      }
    }
  }

  if (!validPdf(pdfBuffer)) {
    throw new Error(
      `No se pudo generar un PDF válido del certificado. ${errors.join(" | ")}`.trim()
    );
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    throw new Error("El certificado supera el tamaño permitido");
  }

  return {
    found: true,
    available: true,
    student,
    pdfBuffer,
    fileName: `CERTIFICADO_MANIPULACION_${documento}.pdf`,
  };
}

module.exports = {
  buildManipulationCertificate,
  downloadPdfIfDirect,
  renderCertificatePage,
};

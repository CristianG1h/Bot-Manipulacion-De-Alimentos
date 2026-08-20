"use strict";

const axios = require("axios");
const cheerio = require("cheerio");
const { findStudent, normalizeDocument } = require("./certificadosBotService");
const { renderUrlToPdf } = require("./browserPdf");

const MAX_PDF_BYTES = Number(process.env.CERTIFICATE_MAX_PDF_BYTES || 12 * 1024 * 1024);

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

async function downloadPdfIfDirect(rawUrl) {
  const url = assertSafeHttpUrl(rawUrl);
  const response = await axios.get(url.href, {
    timeout: 20000,
    maxRedirects: 5,
    responseType: "arraybuffer",
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      Accept: "application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    },
  });

  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  const body = Buffer.from(response.data);

  if (contentType.includes("application/pdf") || body.subarray(0, 5).toString() === "%PDF-") {
    if (body.length > MAX_PDF_BYTES) throw new Error("PDF demasiado grande");
    return body;
  }

  if (!contentType.includes("html")) return null;

  const html = body.toString("utf8");
  const $ = cheerio.load(html);
  const candidates = [];
  $("a[href],iframe[src],embed[src],object[data]").each((_, el) => {
    const raw = $(el).attr("href") || $(el).attr("src") || $(el).attr("data") || "";
    if (raw && (/\.pdf(?:$|[?#])/i.test(raw) || /pdf/i.test(raw))) candidates.push(raw);
  });

  for (const raw of candidates.slice(0, 5)) {
    try {
      const candidate = new URL(raw, url);
      if (!sameOrigin(url, candidate)) continue;
      const pdfResponse = await axios.get(candidate.href, {
        timeout: 15000,
        responseType: "arraybuffer",
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const pdf = Buffer.from(pdfResponse.data);
      const type = String(pdfResponse.headers["content-type"] || "").toLowerCase();
      if (type.includes("application/pdf") || pdf.subarray(0, 5).toString() === "%PDF-") {
        if (pdf.length > MAX_PDF_BYTES) throw new Error("PDF demasiado grande");
        return pdf;
      }
    } catch (_) {
    }
  }

  return null;
}

async function buildManipulationCertificate(documentValue) {
  const documento = normalizeDocument(documentValue);
  const student = await findStudent(documento);
  if (!student) return { found: false, documento };

  if (!student.completado && !student.certificado_url) {
    return {
      found: true,
      available: false,
      student,
      reason: "El estudiante existe, pero todavía no aparece un certificado disponible.",
    };
  }

  const url = student.verification_url;
  let pdfBuffer = null;

  try {
    pdfBuffer = await downloadPdfIfDirect(url);
  } catch (error) {
    console.warn("⚠️ Descarga PDF directa no disponible:", error.message);
  }

  if (!pdfBuffer) {
    pdfBuffer = await renderUrlToPdf(url);
  }

  if (!pdfBuffer?.length || pdfBuffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("No se pudo generar un PDF válido del certificado");
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
};

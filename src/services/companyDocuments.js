"use strict";

const fs = require("fs");
const path = require("path");

const DOCUMENTS_DIR = path.join(__dirname, "..", "assets", "company-documents");

const DOCUMENTS = Object.freeze({
  rut: {
    file: "rut_vip_2026.pdf",
    fileName: "RUT_VIP_SALUD_OCUPACIONAL_2026.pdf",
    title: "RUT actualizado",
    message:
      "📄 *RUT actualizado*\n\nAdjunto el Registro Único Tributario (RUT) de *VIP Salud Ocupacional S.A.S.*.",
    caption: "📄 RUT actualizado — VIP Salud Ocupacional S.A.S.",
  },
  camara: {
    file: "camara_comercio_2026.pdf",
    fileName: "CAMARA_DE_COMERCIO_VIP_SALUD_OCUPACIONAL_2026.pdf",
    title: "Cámara de Comercio",
    message:
      "🏢 *Cámara de Comercio*\n\nAdjunto el certificado de existencia y representación legal de *VIP Salud Ocupacional S.A.S.*.",
    caption: "🏢 Cámara de Comercio — VIP Salud Ocupacional S.A.S.",
  },
  habilitacion: {
    file: "habilitacion_reps.pdf",
    fileName: "HABILITACION_REPS_VIP_SALUD_OCUPACIONAL.pdf",
    title: "Habilitación / REPS",
    message:
      "🏥 *Habilitación / REPS*\n\nAdjunto el documento de habilitación y autoevaluación de servicios de salud de *VIP Salud Ocupacional S.A.S.*.",
    caption: "🏥 Habilitación / REPS — VIP Salud Ocupacional S.A.S.",
  },
  licencia_sst: {
    file: "licencia_medico_sst.pdf",
    fileName: "LICENCIA_MEDICO_SST.pdf",
    title: "Licencia Médico SST",
    message:
      "🩺 *Licencia Médico SST*\n\nAdjunto la licencia vigente aportada para la prestación de servicios en Seguridad y Salud en el Trabajo.",
    caption: "🩺 Licencia Médico SST — VIP Salud Ocupacional",
  },
  bancolombia: {
    file: "certificacion_bancolombia.pdf",
    fileName: "CERTIFICACION_BANCOLOMBIA.pdf",
    title: "Bancolombia",
    message:
      "🏦 *Bancolombia*\n\nTipo de cuenta: *Cuenta de ahorros*\nNúmero: *21700001442*\n\nAdjunto la certificación bancaria.",
    caption: "🏦 Bancolombia — Cuenta de ahorros 21700001442",
  },
  davivienda: {
    file: "certificacion_davivienda.pdf",
    fileName: "CERTIFICACION_DAVIVIENDA.pdf",
    title: "Davivienda",
    message:
      "🏦 *Davivienda*\n\nTipo de cuenta: *Cuenta de ahorros*\nNúmero: *001600128670*\n\nAdjunto la certificación bancaria.",
    caption: "🏦 Davivienda — Cuenta de ahorros 001600128670",
  },
});

function readDocument(key) {
  const metadata = DOCUMENTS[key];
  if (!metadata) throw new Error(`Documento VIP desconocido: ${key}`);

  const filePath = path.join(DOCUMENTS_DIR, metadata.file);
  const pdfBuffer = fs.readFileSync(filePath);
  if (!pdfBuffer.length || pdfBuffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error(`El archivo ${metadata.file} no es un PDF válido`);
  }

  return { ...metadata, pdfBuffer };
}

function getDocumentMetadata(key) {
  return DOCUMENTS[key] ? { ...DOCUMENTS[key] } : null;
}

module.exports = {
  DOCUMENTS_DIR,
  readDocument,
  getDocumentMetadata,
};

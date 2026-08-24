"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const servicePath = path.join(__dirname, "..", "src", "services", "companyDocuments.js");
const { readDocument } = require(servicePath);

for (const key of ["rut", "camara", "habilitacion", "licencia_sst", "bancolombia", "davivienda"]) {
  test(`documento VIP ${key} carga como PDF`, () => {
    const doc = readDocument(key);
    assert.ok(Buffer.isBuffer(doc.pdfBuffer));
    assert.ok(doc.pdfBuffer.length > 1000);
    assert.equal(doc.pdfBuffer.subarray(0, 4).toString("ascii"), "%PDF");
    assert.match(doc.fileName, /\.pdf$/i);
  });
}

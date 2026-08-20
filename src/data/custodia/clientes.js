"use strict";

const zlib = require("zlib");
const compressedBase64 = [
  require("./clientes.parts/01"),
  require("./clientes.parts/02"),
].join("");

module.exports = JSON.parse(
  zlib.gunzipSync(Buffer.from(compressedBase64, "base64")).toString("utf8")
);

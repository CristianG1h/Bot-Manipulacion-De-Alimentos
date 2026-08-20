"use strict";

const fs = require("fs");
const path = require("path");

function dataUrl(fileName, mime) {
  const filePath = path.join(__dirname, "..", "..", "assets", fileName);
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

module.exports = {
  membrete: dataUrl("custodia-background.jpeg", "image/jpeg"),
  firma: dataUrl("custodia-signature.png", "image/png"),
};

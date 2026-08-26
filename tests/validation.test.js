"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCOCell } = require("../src/utils/validation");

test("normaliza celular colombiano con y sin indicativo", () => {
  assert.deepEqual(normalizeCOCell("300 123 4567"), {
    national: "3001234567",
    e164: "+573001234567",
  });

  assert.deepEqual(normalizeCOCell("+57 300 123 4567"), {
    national: "3001234567",
    e164: "+573001234567",
  });
});

test("rechaza números que no son celulares colombianos válidos", () => {
  assert.equal(normalizeCOCell("571234"), null);
  assert.equal(normalizeCOCell("57300123"), null);
  assert.equal(normalizeCOCell("31012345678"), null);
});

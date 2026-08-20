"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDocument,
  parseUsers,
  parseFullName,
} = require("../src/services/certificadosBotService");

test("normaliza cédula con puntos y guiones", () => {
  assert.equal(normalizeDocument("0.000.000.000"), "0000000000");
  assert.equal(normalizeDocument("0-000-000-000"), "0000000000");
});

test("parsea estudiante del panel usando datos sintéticos", () => {
  const html = `
    <table id="usersTable">
      <thead><tr>
        <th>ID</th><th>USUARIO</th><th>DOCUMENTO</th><th>TIPO DOC.</th>
        <th>EMPRESA</th><th>FACTURADO</th><th>PRIMER INGRESO</th><th>ÚLTIMO INGRESO</th>
        <th>CERTIFICADO</th><th>COMPLETADO</th><th>ACCIONES</th>
      </tr></thead>
      <tbody><tr>
        <td>999</td><td>0000000000</td><td>0000000000</td><td>CC</td><td>EMPRESA DEMO SAS</td>
        <td>No</td><td>20/08/2026 10:00</td><td>20/08/2026 10:30</td>
        <td><a href="/certificado/0000000000">Ver</a></td><td>Sí</td>
        <td><a href="/admin/edit/999">Editar</a></td>
      </tr></tbody>
    </table>`;
  const users = parseUsers(html);
  assert.equal(users.length, 1);
  assert.equal(users[0].documento, "0000000000");
  assert.equal(users[0].empresa, "EMPRESA DEMO SAS");
  assert.equal(users[0].completado, true);
  assert.match(users[0].certificado_url, /certificado\/0000000000$/);
});

test("extrae nombre completo del formulario de edición con dato sintético", () => {
  const html = `<div><label for="nombre_completo">Nombre Completo</label><input id="nombre_completo" value="PERSONA DE PRUEBA"></div>`;
  assert.equal(parseFullName(html), "PERSONA DE PRUEBA");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDocument,
  parseUsers,
  parseFullName,
} = require("../src/services/certificadosBotService");

test("normaliza cédula con puntos y guiones", () => {
  assert.equal(normalizeDocument("1.054.538.952"), "1054538952");
  assert.equal(normalizeDocument("1-054-538-952"), "1054538952");
});

test("parsea estudiante del panel usando encabezados", () => {
  const html = `
    <table id="usersTable">
      <thead><tr>
        <th>ID</th><th>USUARIO</th><th>DOCUMENTO</th><th>TIPO DOC.</th>
        <th>EMPRESA</th><th>FACTURADO</th><th>PRIMER INGRESO</th><th>ÚLTIMO INGRESO</th>
        <th>CERTIFICADO</th><th>COMPLETADO</th><th>ACCIONES</th>
      </tr></thead>
      <tbody><tr>
        <td>415</td><td>1054538952</td><td>1054538952</td><td>CC</td><td>AXIONLOG SAS</td>
        <td>No</td><td>19/08/2026 17:51</td><td>19/08/2026 18:41</td>
        <td><a href="/certificado/1054538952">Ver</a></td><td>Sí</td>
        <td><a href="/admin/edit/415">Editar</a></td>
      </tr></tbody>
    </table>`;
  const users = parseUsers(html);
  assert.equal(users.length, 1);
  assert.equal(users[0].documento, "1054538952");
  assert.equal(users[0].empresa, "AXIONLOG SAS");
  assert.equal(users[0].completado, true);
  assert.match(users[0].certificado_url, /certificado\/1054538952$/);
});

test("extrae nombre completo del formulario de edición", () => {
  const html = `<div><label for="nombre_completo">Nombre Completo</label><input id="nombre_completo" value="Jhon Eikin Almanza Arango"></div>`;
  assert.equal(parseFullName(html), "Jhon Eikin Almanza Arango");
});

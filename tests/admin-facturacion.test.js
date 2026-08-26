"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const adminFacturacionRouter = require("../src/routes/adminFacturacion");
const {
  extraerUsuariosDesdeHtml,
  extraerEmpresasSolicitadas,
  obtenerFiltroFacturado,
  filtrarUsuarios,
} = adminFacturacionRouter._test;

const htmlPanelActual = `
<table id="usersTable">
  <thead>
    <tr>
      <th>ID</th>
      <th>USUARIO</th>
      <th>DOCUMENTO</th>
      <th>TIPO DOC.</th>
      <th>EMPRESA</th>
      <th>FACTURADO</th>
      <th>PRIMER INGRESO</th>
      <th>ÚLTIMO INGRESO</th>
      <th>CERTIFICADO</th>
      <th>COMPLETADO</th>
      <th>ACCIONES</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td><td>100000001</td><td>100000001</td><td>CC</td>
      <td>LIVING NATURAL SAS</td><td>⚠️ No</td>
      <td>25/08/2026 08:00</td><td>25/08/2026 08:30</td>
      <td><a href="/certificado/100000001">Ver</a></td><td>✅ Sí</td><td>Editar</td>
    </tr>
    <tr>
      <td>2</td><td>100000002</td><td>100000002</td><td>CC</td>
      <td>TEMPORARY PROFESSIONAL SERVICES SAS</td><td>⚠️ No</td>
      <td>25/08/2026 09:00</td><td>25/08/2026 09:30</td>
      <td></td><td>⚠️ No</td><td>Editar</td>
    </tr>
    <tr>
      <td>3</td><td>100000003</td><td>100000003</td><td>CC</td>
      <td>TEMPORARY PROFESSIONAL SERVICES SAS</td><td>✅ Sí</td>
      <td>25/08/2026 10:00</td><td>25/08/2026 10:30</td>
      <td></td><td>✅ Sí</td><td>Editar</td>
    </tr>
    <tr>
      <td>4</td><td>901000000</td><td>901000000</td><td>NIT</td>
      <td>LIVING NATURAL SAS</td><td>⚠️ No</td>
      <td>25/08/2026 11:00</td><td>25/08/2026 11:30</td>
      <td></td><td>⚠️ No</td><td>Editar</td>
    </tr>
  </tbody>
</table>`;

test("lee la columna FACTURADO del panel actual por encabezado", () => {
  const users = extraerUsuariosDesdeHtml(htmlPanelActual);

  assert.equal(users.length, 4);
  assert.equal(users[0].empresa, "LIVING NATURAL SAS");
  assert.equal(users[0].facturado, false);
  assert.equal(users[1].facturado, false);
  assert.equal(users[2].facturado, true);
  assert.equal(users[0].completado, true);
});

test("acepta varias empresas separadas por coma", () => {
  const empresas = extraerEmpresasSolicitadas(
    "LIVING NATURAL, TEMPORARY PROFESSIONAL SERVICES SAS"
  );

  assert.deepEqual(empresas, [
    "living natural",
    "temporary professional services sas",
  ]);
});

test("filtra solo no facturados de varias empresas y excluye administradores NIT", () => {
  const users = extraerUsuariosDesdeHtml(htmlPanelActual);

  const filtrados = filtrarUsuarios(users, {
    q: "LIVING NATURAL, TEMPORARY PROFESSIONAL SERVICES SAS",
    facturado: "no",
    range: "all",
  });

  assert.deepEqual(
    filtrados.map((u) => u.documento),
    ["100000001", "100000002"]
  );
});

test("interpreta correctamente los filtros Sí, No y Todo", () => {
  assert.equal(obtenerFiltroFacturado("Sí"), true);
  assert.equal(obtenerFiltroFacturado("No"), false);
  assert.equal(obtenerFiltroFacturado("all"), null);
});

"use strict";

(function iniciarFiltroFacturacionEmpresa() {
  const grid = document.querySelector(".filter-grid");
  const searchMode = document.getElementById("searchMode");
  const qInput = document.getElementById("qInput");

  if (!grid || !searchMode || !qInput) {
    console.warn("⚠️ No se pudo inicializar el filtro de facturación por empresa");
    return;
  }

  // Ajuste de columnas para el nuevo filtro sin tocar el diseño responsive.
  const style = document.createElement("style");
  style.textContent = `
    @media (min-width: 1001px) {
      .filter-grid {
        grid-template-columns: 1.45fr .72fr .58fr .72fr .72fr .72fr auto auto;
      }
    }

    .facturado-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 54px;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      border: 1px solid var(--border);
    }

    .facturado-si {
      color: var(--green);
      background: rgba(16, 185, 129, .10);
    }

    .facturado-no {
      color: var(--yellow);
      background: rgba(251, 191, 36, .10);
    }

    .facturado-sin-dato {
      color: var(--muted);
      background: rgba(148, 163, 184, .08);
    }
  `;
  document.head.appendChild(style);

  let facturadoSelect = document.getElementById("facturadoFilter");

  if (!facturadoSelect) {
    const field = document.createElement("div");
    field.className = "field";
    field.id = "facturadoField";

    const label = document.createElement("label");
    label.textContent = "Facturado";

    facturadoSelect = document.createElement("select");
    facturadoSelect.id = "facturadoFilter";
    facturadoSelect.className = "input";

    [
      ["all", "Todo"],
      ["si", "Sí"],
      ["no", "No"],
    ].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      facturadoSelect.appendChild(option);
    });

    field.appendChild(label);
    field.appendChild(facturadoSelect);

    const searchModeField = searchMode.closest(".field");
    searchModeField?.insertAdjacentElement("afterend", field);
  }

  const qFieldLabel = qInput.closest(".field")?.querySelector("label");

  function actualizarModoVisual() {
    const esEmpresa = searchMode.value === "empresa";

    if (qFieldLabel) {
      qFieldLabel.textContent = esEmpresa
        ? "Empresa(s) — puedes escribir varias separadas por coma"
        : "Buscar por número, palabra o evento";
    }

    qInput.placeholder = esEmpresa
      ? "Ej: LIVING NATURAL, TEMPORARY PROFESSIONAL SERVICES SAS"
      : "Ej: 573212340504, certificado, asesor, link...";

    facturadoSelect.disabled = !esEmpresa;

    if (!esEmpresa) {
      facturadoSelect.value = "all";
    }
  }

  function asegurarColumnaFacturado() {
    const headerRow = document.querySelector(
      "#empresaPanel .empresa-table thead tr"
    );

    if (!headerRow || headerRow.querySelector('[data-col="facturado"]')) {
      return;
    }

    const th = document.createElement("th");
    th.dataset.col = "facturado";
    th.textContent = "Facturado";

    const empresaHeader = Array.from(headerRow.children).find(
      (cell) => cell.textContent.trim().toLowerCase() === "empresa"
    );

    if (empresaHeader) {
      empresaHeader.insertAdjacentElement("afterend", th);
    } else {
      headerRow.appendChild(th);
    }
  }

  function etiquetaFacturado(value) {
    if (value === true) return "Sí";
    if (value === false) return "No";
    return "Sin dato";
  }

  function crearCeldaFacturado(value) {
    const td = document.createElement("td");
    const badge = document.createElement("span");

    badge.className = "facturado-badge";

    if (value === true) {
      badge.classList.add("facturado-si");
    } else if (value === false) {
      badge.classList.add("facturado-no");
    } else {
      badge.classList.add("facturado-sin-dato");
    }

    badge.textContent = etiquetaFacturado(value);
    td.appendChild(badge);
    return td;
  }

  revisarFiltroEmpresa = async function revisarFiltroEmpresaFacturacion() {
    const modo = document.getElementById("searchMode")?.value || "bot";
    const q = document.getElementById("qInput")?.value || "";

    if (modo !== "empresa") {
      cerrarPanelEmpresa(false);
      return;
    }

    const empresas = q
      .split(/[\n,;|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2);

    if (!empresas.length) {
      cerrarPanelEmpresa(false);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set("q", q.trim());
      params.set("facturado", facturadoSelect.value || "all");

      const range = document.getElementById("rangeSelect")?.value || "all";
      const from = document.getElementById("fromInput")?.value || "";
      const to = document.getElementById("toInput")?.value || "";

      params.set("range", range);

      if (range === "custom") {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }

      const res = await fetch(`/api/admin-facturacion/empresas?${params.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "No se pudo consultar facturación");
      }

      mostrarPanelEmpresa(data.usuarios || [], {
        empresasConsultadas: empresas,
        facturado: facturadoSelect.value || "all",
        cacheDesactualizada: data.cache_desactualizada === true,
      });
    } catch (error) {
      console.error("❌ Error consultando facturación por empresa:", error);
      alert("No se pudo consultar la facturación de las empresas. Intenta nuevamente.");
    }
  };

  mostrarPanelEmpresa = function mostrarPanelEmpresaFacturacion(usuarios, meta = {}) {
    usuariosEmpresaFiltrados = Array.isArray(usuarios) ? usuarios : [];

    actualizarMetricasCertificadosDesdeUsuarios(usuariosEmpresaFiltrados);
    asegurarColumnaFacturado();

    const panel = document.getElementById("empresaPanel");
    const body = document.getElementById("empresaBody");
    const titulo = document.getElementById("empresaTitulo");
    const subtitulo = document.getElementById("empresaSubtitulo");

    if (!panel || !body || !titulo || !subtitulo) return;

    const empresasUnicas = [
      ...new Set(
        usuariosEmpresaFiltrados
          .map((u) => String(u.empresa || "").trim())
          .filter(Boolean)
      ),
    ];

    if (empresasUnicas.length === 1) {
      titulo.textContent = empresasUnicas[0];
    } else if (empresasUnicas.length > 1) {
      titulo.textContent = `${empresasUnicas.length} empresas seleccionadas`;
    } else {
      const consultadas = Array.isArray(meta.empresasConsultadas)
        ? meta.empresasConsultadas
        : [];
      titulo.textContent = consultadas.length > 1
        ? `${consultadas.length} empresas seleccionadas`
        : consultadas[0] || "Empresas";
    }

    const filtroTexto =
      meta.facturado === "si"
        ? "Facturado: Sí"
        : meta.facturado === "no"
          ? "Facturado: No"
          : "Facturado: Todos";

    subtitulo.textContent =
      `${usuariosEmpresaFiltrados.length} usuario(s) encontrados · ${filtroTexto}` +
      (meta.cacheDesactualizada ? " · Mostrando última información disponible" : "");

    body.replaceChildren();

    if (!usuariosEmpresaFiltrados.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 8;
      td.style.textAlign = "center";
      td.style.color = "var(--muted)";
      td.style.padding = "22px";
      td.textContent =
        "No hay usuarios que coincidan con las empresas, la fecha y el estado de facturación seleccionados.";
      tr.appendChild(td);
      body.appendChild(tr);
    } else {
      const fragment = document.createDocumentFragment();

      usuariosEmpresaFiltrados.forEach((u) => {
        const tr = document.createElement("tr");

        tr.appendChild(crearCeldaTexto(u.nombre || u.usuario || ""));
        tr.appendChild(crearCeldaTexto(u.documento || ""));
        tr.appendChild(crearCeldaTexto(u.empresa || ""));
        tr.appendChild(crearCeldaFacturado(u.facturado));
        tr.appendChild(
          crearCeldaTexto(
            u.primer_ingreso === "—" ? "" : (u.primer_ingreso || "")
          )
        );
        tr.appendChild(
          crearCeldaTexto(
            u.ultimo_ingreso === "—" ? "" : (u.ultimo_ingreso || "")
          )
        );
        tr.appendChild(crearCeldaTexto(u.completado === true ? "Sí" : "No"));

        const tdCertificado = document.createElement("td");
        const urlSegura = obtenerUrlHttpSegura(u.certificado_url);

        if (urlSegura) {
          const link = document.createElement("a");
          link.href = urlSegura;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "empresa-cert-link";
          link.textContent = "Ver certificado";
          tdCertificado.appendChild(link);
        }

        tr.appendChild(tdCertificado);
        fragment.appendChild(tr);
      });

      body.appendChild(fragment);
    }

    panel.classList.remove("hidden");
    document.querySelector(".charts-row")?.classList.add("hidden");
    document.querySelector(".bottom-row")?.classList.add("hidden");
  };

  descargarExcelEmpresa = function descargarExcelEmpresaFacturacion() {
    if (!usuariosEmpresaFiltrados.length) {
      alert("No hay datos de empresa para descargar.");
      return;
    }

    const empresasUnicas = [
      ...new Set(
        usuariosEmpresaFiltrados
          .map((u) => String(u.empresa || "").trim())
          .filter(Boolean)
      ),
    ];

    const titulo = empresasUnicas.length === 1
      ? empresasUnicas[0]
      : `${empresasUnicas.length} EMPRESAS SELECCIONADAS`;

    const rows = [
      [titulo],
      [],
      [
        "Nombre",
        "Cédula",
        "Empresa",
        "Facturado",
        "Primer ingreso",
        "Último ingreso",
        "Realizó curso",
        "Link certificado",
      ],
      ...usuariosEmpresaFiltrados.map((u) => [
        u.nombre || u.usuario || "",
        u.documento || "",
        u.empresa || "",
        etiquetaFacturado(u.facturado),
        u.primer_ingreso === "—" ? "" : (u.primer_ingreso || ""),
        u.ultimo_ingreso === "—" ? "" : (u.ultimo_ingreso || ""),
        u.completado === true ? "Sí" : "No",
        u.certificado_url || "",
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
    ws["!cols"] = [
      { wch: 28 },
      { wch: 16 },
      { wch: 36 },
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 16 },
      { wch: 60 },
    ];

    ws["A1"].s = {
      font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "1F4E78" } },
    };

    const headerRow = 2;
    for (let col = 0; col <= 7; col += 1) {
      const cell = XLSX.utils.encode_cell({ r: headerRow, c: col });
      if (!ws[cell]) continue;

      ws[cell].s = {
        font: { bold: true, color: { rgb: "000000" } },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "D9EAF7" } },
        border: {
          top: { style: "thin", color: { rgb: "000000" } },
          bottom: { style: "thin", color: { rgb: "000000" } },
          left: { style: "thin", color: { rgb: "000000" } },
          right: { style: "thin", color: { rgb: "000000" } },
        },
      };
    }

    for (let row = 3; row < rows.length; row += 1) {
      for (let col = 0; col <= 7; col += 1) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (!ws[cell]) continue;

        ws[cell].s = {
          alignment: { vertical: "center", wrapText: true },
          border: {
            top: { style: "thin", color: { rgb: "BFBFBF" } },
            bottom: { style: "thin", color: { rgb: "BFBFBF" } },
            left: { style: "thin", color: { rgb: "BFBFBF" } },
            right: { style: "thin", color: { rgb: "BFBFBF" } },
          },
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Usuarios empresas");

    const sufijoFacturado =
      facturadoSelect.value === "no"
        ? "no_facturados"
        : facturadoSelect.value === "si"
          ? "facturados"
          : "todos";

    const baseNombre = empresasUnicas.length === 1
      ? empresasUnicas[0]
      : "empresas_seleccionadas";

    const nombreArchivo = baseNombre
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();

    XLSX.writeFile(wb, `${nombreArchivo}_${sufijoFacturado}.xlsx`);
  };

  if (typeof clearFilters === "function") {
    const clearFiltersOriginal = clearFilters;

    clearFilters = function clearFiltersConFacturacion() {
      facturadoSelect.value = "all";
      const result = clearFiltersOriginal();
      actualizarModoVisual();
      return result;
    };
  }

  facturadoSelect.addEventListener("change", () => {
    if (searchMode.value === "empresa") {
      revisarFiltroEmpresa();
    }
  });

  searchMode.addEventListener("change", actualizarModoVisual);

  asegurarColumnaFacturado();
  actualizarModoVisual();

  console.log("✅ Filtro multiempresa y facturación activo en dashboard");
})();

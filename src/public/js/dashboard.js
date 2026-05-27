    let isLight = false;
    let lineChart = null;
    let donutChart = null;
    let usuariosCertificadosCache = [];
    let usuariosEmpresaFiltrados = [];
    let debounceTimer = null;
    let chartRange = "14d";
    let chartOffset = 0;
    let logsPage = 0;
    const logsPageSize = 10;

    const kwColors = [
      "#3b82f6",
      "#10b981",
      "#fbbf24",
      "#a78bfa",
      "#f87171",
      "#60a5fa",
      "#fb923c",
      "#22c55e",
      "#8b5cf6"
    ];

    function toggleTheme() {
      isLight = !isLight;
      document.body.classList.toggle("light", isLight);

      document.getElementById("themeBtn").innerHTML = isLight
        ? '<i class="ti ti-moon"></i> Modo oscuro'
        : '<i class="ti ti-sun"></i> Modo claro';

      if (window.lastData) {
        renderCharts(window.lastData);
      }
    }

    function formatNumber(n) {
      return Number(n || 0).toLocaleString("es-CO");
    }

    function formatUptime(seconds) {
      seconds = Number(seconds || 0);

      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;

      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    }

    function badgeClass(estado) {
      return {
        ok: "b-ok",
        warn: "b-warn",
        asesor: "b-asesor",
        error: "b-error"
      }[estado] || "b-ok";
    }

    function badgeLabel(estado) {
      return {
        ok: "OK",
        warn: "Alerta",
        asesor: "Asesor",
        error: "Error"
      }[estado] || "OK";
    }

    function syncChartWithMainFilter() {
  const mainRange = document.getElementById("rangeSelect")?.value || "all";
  const chartSelect = document.getElementById("chartRangeSelect");
  const chartCustomBox = document.getElementById("chartCustomDates");

  if (!chartSelect) return;

  if (mainRange === "all") {
    chartSelect.value = "14d";
    chartRange = "14d";
  } else if (mainRange === "today") {
    chartSelect.value = "today";
    chartRange = "today";
  } else if (mainRange === "7d") {
    chartSelect.value = "7d";
    chartRange = "7d";
  } else if (mainRange === "30d") {
    chartSelect.value = "30d";
    chartRange = "30d";
  } else if (mainRange === "custom") {
    chartSelect.value = "custom";
    chartRange = "custom";

    const mainFrom = document.getElementById("fromInput")?.value || "";
    const mainTo = document.getElementById("toInput")?.value || "";

    const chartFrom = document.getElementById("chartFromInput");
    const chartTo = document.getElementById("chartToInput");

    if (chartFrom && mainFrom) {
      chartFrom.value = mainFrom;
    }

    if (chartTo && mainTo) {
      chartTo.value = mainTo;
    }
  }

  if (chartCustomBox) {
    chartCustomBox.classList.toggle("hidden", chartRange !== "custom");
  }
}

    function buildQueryParams() {
  const params = new URLSearchParams();

  const q = document.getElementById("qInput").value.trim();
  const range = document.getElementById("rangeSelect").value;
  const from = document.getElementById("fromInput").value;
  const to = document.getElementById("toInput").value;

  const chartRangeValue = document.getElementById("chartRangeSelect")?.value || "14d";
  const chartFrom = document.getElementById("chartFromInput")?.value || "";
  const chartTo = document.getElementById("chartToInput")?.value || "";

  if (q) {
    params.set("q", q);
  }

  if (range) {
    params.set("range", range);
  }

  if (range === "custom") {
    if (from) params.set("from", from);
    if (to) params.set("to", to);
  }

  params.set("chartRange", chartRangeValue);
  params.set("chartOffset", String(chartOffset));

  if (chartRangeValue === "custom") {
    if (chartFrom) params.set("chartFrom", chartFrom);
    if (chartTo) params.set("chartTo", chartTo);
  }

  return params.toString();
}
    function renderCharts(data) {
      const textColor = isLight ? "#64748b" : "#9db7d8";
      const gridColor = isLight ? "rgba(15,23,42,.08)" : "rgba(148,163,184,.09)";

      if (lineChart) lineChart.destroy();

      lineChart = new Chart(document.getElementById("lineChart"), {
        type: "line",
        data: {
          labels: data.actividadPorDia.map(d => d.label),
          datasets: [{
            label: "Interacciones",
            data: data.actividadPorDia.map(d => d.total),
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,.14)",
            fill: true,
            tension: .42,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: "#3b82f6"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              ticks: { color: textColor, font: { size: 10 } },
              grid: { color: gridColor }
            },
            y: {
              beginAtZero: true,
              ticks: { color: textColor, font: { size: 10 }, precision: 0 },
              grid: { color: gridColor }
            }
          }
        }
      });

      const totals = data.totales || {};
      const kws = data.keywords || {};

      // Dona: solo acciones/palabras clave. No incluye "mensajes recibidos".
      const donutData = [
        { label: "Hola / Menú", val: kws.menu || kws.hola || 0, color: "#3b82f6" },
        { label: "Instructivo", val: kws.instructivo || 0, color: "#10b981" },
        { label: "Link", val: kws.link || 0, color: "#22c55e" },
        { label: "Recibido", val: kws.recibido || 0, color: "#a78bfa" },
        { label: "Acceso", val: totals.accesosEnviados || kws.acceso || 0, color: "#fbbf24" },
        { label: "Certificado", val: totals.certificadosEnviados || kws.certificado || 0, color: "#8b5cf6" },
        { label: "Asesor", val: totals.asesoresActivados || kws.asesor || 0, color: "#fb923c" },
        { label: "No reconocido", val: totals.mensajesNoReconocidos || 0, color: "#f87171" }
      ].filter(x => Number(x.val || 0) > 0);

      if (donutChart) donutChart.destroy();

      donutChart = new Chart(document.getElementById("donutChart"), {
        type: "doughnut",
        data: {
          labels: donutData.length ? donutData.map(d => d.label) : ["Sin datos"],
          datasets: [{
            data: donutData.length ? donutData.map(d => Number(d.val || 0)) : [1],
            backgroundColor: donutData.length
              ? donutData.map(d => d.color)
              : ["rgba(148,163,184,.25)"],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "70%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: textColor,
                boxWidth: 10,
                usePointStyle: true
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || "";
                  const value = Number(context.raw || 0);
                  const total = context.dataset.data.reduce((a, b) => Number(a) + Number(b), 0);
                  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                  return `${label}: ${value} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    function formatFecha(value) {
  if (!value) return "—";

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    return "—";
  }

  return d.toLocaleDateString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

    function renderLogs(items) {
  const body = document.getElementById("logBody");
  const pageInfo = document.getElementById("logPageInfo");
  const prevBtn = document.getElementById("logPrevBtn");
  const nextBtn = document.getElementById("logNextBtn");

  const logs = Array.isArray(items) ? items : [];
  const totalPages = Math.max(1, Math.ceil(logs.length / logsPageSize));

  if (logsPage > totalPages - 1) {
    logsPage = totalPages - 1;
  }

  if (logsPage < 0) {
    logsPage = 0;
  }

  if (!logs.length) {
    body.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center;color:var(--muted);padding:22px">
          Sin resultados para este filtro
        </td>
      </tr>
    `;

    if (pageInfo) pageInfo.textContent = "Página 0 de 0";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    return;
  }

  const start = logsPage * logsPageSize;
  const end = start + logsPageSize;
  const pageItems = logs.slice(start, end);

  body.innerHTML = pageItems.map(i => {
    const fecha = formatFecha(i.fecha || i.ts);
    const hora = i.hora || "—";

    return `
      <tr>
        <td style="color:var(--muted);white-space:nowrap">
          <div class="log-date">${fecha}</div>
          <div class="log-time">${hora}</div>
        </td>
        <td>${i.detalle || "—"}</td>
        <td><span class="badge ${badgeClass(i.estado)}">${badgeLabel(i.estado)}</span></td>
      </tr>
    `;
  }).join("");

  if (pageInfo) {
    pageInfo.textContent = `Página ${logsPage + 1} de ${totalPages}`;
  }

  if (prevBtn) {
    prevBtn.disabled = logsPage <= 0;
  }

  if (nextBtn) {
    nextBtn.disabled = logsPage >= totalPages - 1;
  }
}

function moveLogsPage(direction) {
  logsPage += Number(direction || 0);
  renderLogs(window.lastData?.ultimasInteracciones || []);
}

    function renderKeywords(keywords) {
      const entries = Object.entries(keywords || {})
        .filter(([, v]) => Number(v || 0) >= 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]));

      const max = entries[0]?.[1] || 1;

      document.getElementById("kwBars").innerHTML = entries.map(([key, val], index) => `
        <div class="kw-row">
          <div class="kw-label">${key}</div>
          <div class="kw-track">
            <div class="kw-fill" style="width:${Math.round((val / max) * 100)}%;background:${kwColors[index % kwColors.length]}"></div>
          </div>
          <div class="kw-count">${val}</div>
        </div>
      `).join("");
    }

    function updateActivityTitle(data) {
  const chartRangeValue = document.getElementById("chartRangeSelect")?.value || "14d";
  const title = document.getElementById("activityTitle");
  const sub = document.getElementById("activitySub");

  const labels = {
    today: "Actividad diaria — hoy",
    "7d": "Actividad diaria — últimos 7 días",
    "14d": "Actividad diaria — últimos 14 días",
    "30d": "Actividad diaria — últimos 30 días",
    custom: "Actividad diaria — rango personalizado",
  };

  title.textContent = labels[chartRangeValue] || "Actividad diaria";

  if (data?.chartMeta?.desde && data?.chartMeta?.hasta) {
    sub.textContent = `Interacciones del ${data.chartMeta.desde} al ${data.chartMeta.hasta}`;
  } else {
    sub.textContent = "Interacciones registradas por día según el filtro aplicado";
  }
}

function changeChartRange() {
  chartRange = document.getElementById("chartRangeSelect").value;
  chartOffset = 0;

  const customBox = document.getElementById("chartCustomDates");

  if (customBox) {
    customBox.classList.toggle("hidden", chartRange !== "custom");
  }

  loadStats();
}

function moveChartRange(direction) {
  const currentRange = document.getElementById("chartRangeSelect")?.value || "14d";

  if (currentRange === "custom") {
    return;
  }

  chartOffset += Number(direction || 0);
  loadStats();
}

    async function loadStats() {
      try {
        const query = buildQueryParams();
        const url = query ? `/api/stats?${query}` : "/api/stats";

        const res = await fetch(url, { cache: "no-store" });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        window.lastData = data;
        updateActivityTitle(data);

        const setBotText = (id, value) => {
          const el = document.getElementById(id);
          if (el) el.textContent = formatNumber(value);
        };

        setBotText("m-conv", data.totales.conversaciones);
        setBotText("m-rec", data.totales.mensajesRecibidos);
        setBotText("m-msg", data.totales.mensajesEnviados);
        setBotText("m-acc", data.totales.accesosEnviados);

        document.getElementById("uptimeVal").textContent = formatUptime(data.uptime);
        document.getElementById("iniciadoEn").textContent = new Date(data.iniciadoEn).toLocaleString("es-CO");
        document.getElementById("lastUpdate").textContent = new Date().toLocaleTimeString("es-CO");
        document.getElementById("persistencia").textContent = data.persistencia || "—";

        renderCharts(data);
          if (!window.lastLogsFilterKey) {
  window.lastLogsFilterKey = "";
}

const currentLogsFilterKey = buildQueryParams();

if (window.lastLogsFilterKey !== currentLogsFilterKey) {
  logsPage = 0;
  window.lastLogsFilterKey = currentLogsFilterKey;
}
        renderLogs(data.ultimasInteracciones);
        renderKeywords(data.keywords);
      } catch (error) {
        console.error("Error cargando estadísticas:", error);
      }
    }


   async function cargarMetricasCertificados() {
  try {
    const res = await fetch("/api/admin-certificados", { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!data.ok) {
      console.error("❌ Error cargando métricas certificados:", data);
      return;
    }

    usuariosCertificadosCache = Array.isArray(data.usuarios) ? data.usuarios : [];

    const m = data.metricas || {};

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = formatNumber(value);
    };

    setText("totalUsuariosCertificados", m.total_usuarios);
    setText("m-cert", m.certificados_emitidos);
    setText("totalFacturados", m.total_facturados);
    setText("totalNoFacturados", m.total_no_facturados);

    revisarFiltroEmpresa();
  } catch (error) {
    console.error("❌ Error conectando con /api/admin-certificados:", error);
  }
}

function normalizarTextoEmpresa(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function esUsuarioAdministradorEmpresa(u) {
  const tipoDoc = String(u.tipo_doc || "").toUpperCase().trim();
  const rol = String(u.rol_detectado || "").toLowerCase().trim();

  return tipoDoc === "NIT" || rol === "administrador";
}

function parseFechaPanelCertificados(value) {
  if (!value || value === "—") return null;

  const texto = String(value).trim();

  // Formato esperado: 26/05/2026 11:43
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);

  const date = new Date(year, month, day, hour, minute, 0);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function inicioDia(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function finDia(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getRangoFechaEmpresa() {
  const range = document.getElementById("rangeSelect")?.value || "all";
  const fromInput = document.getElementById("fromInput")?.value || "";
  const toInput = document.getElementById("toInput")?.value || "";

  const hoy = new Date();
  const hoyInicio = inicioDia(hoy);
  const hoyFin = finDia(hoy);

  if (range === "all") {
    return null;
  }

  if (range === "today") {
    return {
      desde: hoyInicio,
      hasta: hoyFin,
    };
  }

  if (range === "7d") {
    const desde = inicioDia(hoy);
    desde.setDate(desde.getDate() - 6);

    return {
      desde,
      hasta: hoyFin,
    };
  }

  if (range === "30d") {
    const desde = inicioDia(hoy);
    desde.setDate(desde.getDate() - 29);

    return {
      desde,
      hasta: hoyFin,
    };
  }

  if (range === "custom") {
    if (!fromInput && !toInput) return null;

    let desde = null;
    let hasta = null;

    if (fromInput) {
      const [year, month, day] = fromInput.split("-").map(Number);
      desde = inicioDia(new Date(year, month - 1, day));
    }

    if (toInput) {
      const [year, month, day] = toInput.split("-").map(Number);
      hasta = finDia(new Date(year, month - 1, day));
    }

    return {
      desde,
      hasta,
    };
  }

  return null;
}

function usuarioCumpleFiltroFechaEmpresa(u) {
  const rango = getRangoFechaEmpresa();

  if (!rango) return true;

  const fechaPrimerIngreso = parseFechaPanelCertificados(u.primer_ingreso);
  const fechaUltimoIngreso = parseFechaPanelCertificados(u.ultimo_ingreso);

  // Usamos la fecha que exista. Primero último ingreso, si no existe primer ingreso.
  const fecha = fechaUltimoIngreso || fechaPrimerIngreso;

  if (!fecha) return false;

  if (rango.desde && fecha < rango.desde) return false;
  if (rango.hasta && fecha > rango.hasta) return false;

  return true;
}

function revisarFiltroEmpresa() {
  const q = normalizarTextoEmpresa(document.getElementById("qInput")?.value || "");

  if (!q || q.length < 3) {
    cerrarPanelEmpresa(false);
    return;
  }

  const resultados = usuariosCertificadosCache.filter((u) => {
    if (esUsuarioAdministradorEmpresa(u)) {
      return false;
    }

    const empresa = normalizarTextoEmpresa(u.empresa);
    const coincideEmpresa = empresa.includes(q);
    const cumpleFecha = usuarioCumpleFiltroFechaEmpresa(u);

    return coincideEmpresa && cumpleFecha;
  });

  if (!resultados.length) {
    mostrarPanelEmpresa([]);
    return;
  }

  mostrarPanelEmpresa(resultados);
}

function mostrarPanelEmpresa(usuarios) {
  usuariosEmpresaFiltrados = Array.isArray(usuarios) ? usuarios : [];

  const panel = document.getElementById("empresaPanel");
  const body = document.getElementById("empresaBody");
  const titulo = document.getElementById("empresaTitulo");
  const subtitulo = document.getElementById("empresaSubtitulo");

  if (!panel || !body) return;

  const q = document.getElementById("qInput")?.value || "";
  const empresaNombre = usuariosEmpresaFiltrados[0]?.empresa || `Búsqueda: ${q}`;

  titulo.textContent = empresaNombre;
  subtitulo.textContent = `${usuariosEmpresaFiltrados.length} usuario(s) encontrados según empresa y fecha`;

  if (!usuariosEmpresaFiltrados.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;color:var(--muted);padding:22px">
          No hay usuarios de curso para esta empresa en el rango seleccionado.
        </td>
      </tr>
    `;
  } else {
    body.innerHTML = usuariosEmpresaFiltrados.map((u) => {
      const nombre = u.usuario || "";
      const cedula = u.documento || "";
      const empresa = u.empresa || "";
      const primerIngreso = u.primer_ingreso === "—" ? "" : (u.primer_ingreso || "");
      const ultimoIngreso = u.ultimo_ingreso === "—" ? "" : (u.ultimo_ingreso || "");
      const realizoCurso = u.completado === true ? "Sí" : "No";
      const certificado = u.certificado_url
        ? `<a href="${u.certificado_url}" target="_blank" class="empresa-cert-link">Ver certificado</a>`
        : "";

      return `
        <tr>
          <td>${nombre}</td>
          <td>${cedula}</td>
          <td>${empresa}</td>
          <td>${primerIngreso}</td>
          <td>${ultimoIngreso}</td>
          <td>${realizoCurso}</td>
          <td>${certificado}</td>
        </tr>
      `;
    }).join("");
  }

  panel.classList.remove("hidden");

  document.querySelector(".charts-row")?.classList.add("hidden");
  document.querySelector(".bottom-row")?.classList.add("hidden");
}

function cerrarPanelEmpresa(limpiarBusqueda = true) {
  const panel = document.getElementById("empresaPanel");

  if (panel) {
    panel.classList.add("hidden");
  }

  document.querySelector(".charts-row")?.classList.remove("hidden");
  document.querySelector(".bottom-row")?.classList.remove("hidden");

  usuariosEmpresaFiltrados = [];

  if (limpiarBusqueda) {
    const input = document.getElementById("qInput");
    if (input) input.value = "";
    loadStats();
  }
}

function descargarExcelEmpresa() {
  if (!usuariosEmpresaFiltrados.length) {
    alert("No hay datos de empresa para descargar.");
    return;
  }

  const empresaNombre = usuariosEmpresaFiltrados[0]?.empresa || "Empresa";

  const rows = [
    [empresaNombre],
    [],
    [
      "Nombre",
      "Cédula",
      "Empresa",
      "Primer ingreso",
      "Último ingreso",
      "Realizó curso",
      "Link certificado"
    ],
    ...usuariosEmpresaFiltrados.map((u) => [
      u.usuario || "",
      u.documento || "",
      u.empresa || "",
      u.primer_ingreso === "—" ? "" : (u.primer_ingreso || ""),
      u.ultimo_ingreso === "—" ? "" : (u.ultimo_ingreso || ""),
      u.completado === true ? "Sí" : "No",
      u.certificado_url || ""
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }
  ];

  ws["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 36 },
    { wch: 20 },
    { wch: 20 },
    { wch: 16 },
    { wch: 60 }
  ];

  ws["A1"].s = {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" },
    fill: { fgColor: { rgb: "1F4E78" } }
  };

  const headerRow = 2;
  for (let col = 0; col <= 6; col++) {
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
        right: { style: "thin", color: { rgb: "000000" } }
      }
    };
  }

  for (let row = 3; row < rows.length; row++) {
    for (let col = 0; col <= 6; col++) {
      const cell = XLSX.utils.encode_cell({ r: row, c: col });
      if (!ws[cell]) continue;

      ws[cell].s = {
        alignment: { vertical: "center", wrapText: true },
        border: {
          top: { style: "thin", color: { rgb: "BFBFBF" } },
          bottom: { style: "thin", color: { rgb: "BFBFBF" } },
          left: { style: "thin", color: { rgb: "BFBFBF" } },
          right: { style: "thin", color: { rgb: "BFBFBF" } }
        }
      };
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Usuarios empresa");

  const nombreArchivo = empresaNombre
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();

  XLSX.writeFile(wb, `${nombreArchivo}_usuarios.xlsx`);
}

    function clearFilters() {
  document.getElementById("qInput").value = "";
  cerrarPanelEmpresa(false);
  document.getElementById("rangeSelect").value = "all";
  document.getElementById("fromInput").value = "";
  document.getElementById("toInput").value = "";

  const chartSelect = document.getElementById("chartRangeSelect");
  const chartFrom = document.getElementById("chartFromInput");
  const chartTo = document.getElementById("chartToInput");
  const chartCustomBox = document.getElementById("chartCustomDates");

  if (chartSelect) chartSelect.value = "14d";
  if (chartFrom) chartFrom.value = "";
  if (chartTo) chartTo.value = "";
  if (chartCustomBox) chartCustomBox.classList.add("hidden");

  chartRange = "14d";
  chartOffset = 0;

  document.getElementById("rangeDropdownLabel").textContent = "Todo";

  document.querySelectorAll("#rangeDropdownMenu .custom-option").forEach((option) => {
    option.classList.toggle("active", option.dataset.value === "all");
  });

  toggleCustomFields();
  loadStats();
}

    function toggleCustomFields() {
      const range = document.getElementById("rangeSelect").value;
      document.querySelectorAll(".custom-field").forEach(el => {
        el.classList.toggle("hidden", range !== "custom");
      });
    }

function initRangeDropdown() {
  const dropdown = document.getElementById("rangeDropdown");
  const btn = document.getElementById("rangeDropdownBtn");
  const label = document.getElementById("rangeDropdownLabel");
  const hiddenInput = document.getElementById("rangeSelect");
  const options = document.querySelectorAll("#rangeDropdownMenu .custom-option");

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    dropdown.classList.toggle("open");
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      const value = option.dataset.value;
      const text = option.querySelector("span").textContent.trim();

      hiddenInput.value = value;
      label.textContent = text;

      options.forEach((o) => o.classList.remove("active"));
      option.classList.add("active");

      dropdown.classList.remove("open");

        chartOffset = 0;
        toggleCustomFields();
        syncChartWithMainFilter();
        loadStats();
        revisarFiltroEmpresa();
    });
  });

  document.addEventListener("click", () => {
    dropdown.classList.remove("open");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dropdown.classList.remove("open");
    }
  });
}
    
    document.getElementById("fromInput").addEventListener("change", () => {
  chartOffset = 0;
  syncChartWithMainFilter();
  loadStats();
  revisarFiltroEmpresa();
});

document.getElementById("toInput").addEventListener("change", () => {
  chartOffset = 0;
  syncChartWithMainFilter();
  loadStats();
  revisarFiltroEmpresa();
});

    document.getElementById("qInput").addEventListener("input", () => {
  clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    loadStats();
    revisarFiltroEmpresa();
  }, 500);
});

    flatpickr("#fromInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: () => {
  loadStats();
  revisarFiltroEmpresa();
},
});

flatpickr("#toInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: () => {
  loadStats();
  revisarFiltroEmpresa();
},
});

flatpickr("#chartFromInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: loadStats,
});

flatpickr("#chartToInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: loadStats,
});

    initRangeDropdown();
toggleCustomFields();
loadStats();
cargarMetricasCertificados();
setInterval(loadStats, 15000);
setInterval(cargarMetricasCertificados, 60000);

window.addEventListener("resize", () => {
  if (lineChart) lineChart.resize();
  if (donutChart) donutChart.resize();
});

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    if (lineChart) lineChart.resize();
    if (donutChart) donutChart.resize();
    loadStats();
  }, 350);
});

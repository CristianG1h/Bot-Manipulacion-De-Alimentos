    let isLight = false;
    let lineChart = null;
    let donutChart = null;
    let debounceTimer = null;
    let chartRange = "14d";
    let chartOffset = 0;

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

    function buildQueryParams() {
  const params = new URLSearchParams();

  const q = document.getElementById("qInput").value.trim();
  const range = document.getElementById("rangeSelect").value;
  const from = document.getElementById("fromInput").value;
  const to = document.getElementById("toInput").value;

  const chartRangeValue = document.getElementById("chartRangeSelect")?.value || "14d";
  const chartFrom = document.getElementById("chartFromInput")?.value || "";
  const chartTo = document.getElementById("chartToInput")?.value || "";

  if (q) params.set("q", q);
  if (range) params.set("range", range);

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

    function renderLogs(items) {
      const body = document.getElementById("logBody");

      if (!items || !items.length) {
        body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:22px">Sin resultados para este filtro</td></tr>';
        return;
      }

      body.innerHTML = items.map(i => `
        <tr>
          <td style="color:var(--muted);white-space:nowrap">${i.hora || "—"}</td>
          <td>${i.detalle || "—"}</td>
          <td><span class="badge ${badgeClass(i.estado)}">${badgeLabel(i.estado)}</span></td>
        </tr>
      `).join("");
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
  customBox.classList.toggle("hidden", chartRange !== "custom");

  loadStats();
}

function moveChartRange(direction) {
  const currentRange = document.getElementById("chartRangeSelect").value;

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

        document.getElementById("m-conv").textContent = formatNumber(data.totales.conversaciones);
        document.getElementById("m-rec").textContent = formatNumber(data.totales.mensajesRecibidos);
        document.getElementById("m-msg").textContent = formatNumber(data.totales.mensajesEnviados);
        document.getElementById("m-acc").textContent = formatNumber(data.totales.accesosEnviados);
        document.getElementById("m-cert").textContent = formatNumber(data.totales.certificadosEnviados);
        document.getElementById("m-asesor").textContent = formatNumber(data.totales.asesoresActivados);
        document.getElementById("m-norec").textContent = formatNumber(data.totales.mensajesNoReconocidos);

        document.getElementById("uptimeVal").textContent = formatUptime(data.uptime);
        document.getElementById("iniciadoEn").textContent = new Date(data.iniciadoEn).toLocaleString("es-CO");
        document.getElementById("lastUpdate").textContent = new Date().toLocaleTimeString("es-CO");
        document.getElementById("persistencia").textContent = data.persistencia || "—";

        renderCharts(data);
        renderLogs(data.ultimasInteracciones);
        renderKeywords(data.keywords);
      } catch (error) {
        console.error("Error cargando estadísticas:", error);
      }
    }

    function clearFilters() {
  document.getElementById("qInput").value = "";
  document.getElementById("rangeSelect").value = "all";
  document.getElementById("fromInput").value = "";
  document.getElementById("toInput").value = "";

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

      toggleCustomFields();
      loadStats();
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
    
    document.getElementById("fromInput").addEventListener("change", loadStats);
    document.getElementById("toInput").addEventListener("change", loadStats);

    document.getElementById("qInput").addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadStats, 500);
    });

    flatpickr("#fromInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: loadStats,
});

flatpickr("#toInput", {
  locale: "es",
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  onChange: loadStats,
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
setInterval(loadStats, 15000);

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

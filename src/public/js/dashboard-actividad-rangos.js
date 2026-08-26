"use strict";

(function mejorarGraficaActividad() {
  const select = document.getElementById("chartRangeSelect");
  const controls = document.querySelector(".chart-controls");
  const customBox = document.getElementById("chartCustomDates");
  const fromInput = document.getElementById("chartFromInput");
  const toInput = document.getElementById("chartToInput");

  if (!select || !controls || !fromInput || !toInput) {
    return;
  }

  const periodos = [
    { key: "1d", label: "1D", title: "Hoy" },
    { key: "5d", label: "5D", title: "Últimos 5 días" },
    { key: "14d", label: "14D", title: "Últimos 14 días" },
    { key: "1m", label: "1M", title: "Último mes" },
    { key: "1y", label: "1A", title: "Último año" },
    { key: "5y", label: "5A", title: "Últimos 5 años" },
    { key: "max", label: "Máx.", title: "Todo el histórico" },
  ];

  const estilos = document.createElement("style");
  estilos.textContent = `
    .chart-controls.activity-period-controls {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px;
      border-radius: 14px;
      background: rgba(15, 23, 42, .22);
      border: 1px solid rgba(96, 165, 250, .10);
      max-width: 100%;
    }

    .activity-range-source {
      display: none !important;
    }

    .activity-period-btn {
      min-width: 42px;
      height: 34px;
      padding: 0 9px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      transition: background .16s ease, color .16s ease, transform .16s ease;
    }

    .activity-period-btn:hover {
      color: var(--text);
      background: rgba(59, 130, 246, .10);
    }

    .activity-period-btn.active {
      color: #dbeafe;
      background: rgba(59, 130, 246, .22);
      box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .16);
    }

    .light .chart-controls.activity-period-controls {
      background: rgba(226, 232, 240, .55);
      border-color: rgba(37, 99, 235, .10);
    }

    .light .activity-period-btn.active {
      color: #1d4ed8;
      background: rgba(37, 99, 235, .13);
    }

    @media (max-width: 768px) {
      .chart-controls.activity-period-controls {
        display: flex;
        width: 100%;
        overflow-x: auto;
        overscroll-behavior-inline: contain;
        scrollbar-width: thin;
        justify-content: flex-start;
      }

      .activity-period-btn {
        flex: 0 0 auto;
      }
    }
  `;
  document.head.appendChild(estilos);

  const renderChartsBase = renderCharts;
  const updateActivityTitleBase = updateActivityTitle;
  const syncChartWithMainFilterBase = syncChartWithMainFilter;
  const clearFiltersBase = clearFilters;

  window.__activityRangeKey = "14d";

  function fechaBogota(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function inicioMaximoDisponible() {
    const iniciado = window.lastData?.iniciadoEn
      ? new Date(window.lastData.iniciadoEn)
      : null;

    if (iniciado && !Number.isNaN(iniciado.getTime())) {
      return iniciado;
    }

    const fallback = new Date();
    fallback.setFullYear(fallback.getFullYear() - 5);
    return fallback;
  }

  function setCustomRange(desde, hasta = new Date()) {
    select.value = "custom";
    chartRange = "custom";
    fromInput.value = fechaBogota(desde);
    toInput.value = fechaBogota(hasta);
  }

  function actualizarBotones() {
    controls.querySelectorAll(".activity-period-btn").forEach((button) => {
      const active = button.dataset.range === window.__activityRangeKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function aplicarPeriodo(key, recargar = true) {
    const hoy = new Date();
    const desde = new Date(hoy);

    window.__activityRangeKey = key;
    chartOffset = 0;

    if (key === "1d") {
      select.value = "today";
      chartRange = "today";
      fromInput.value = "";
      toInput.value = "";
    } else if (key === "5d") {
      desde.setDate(desde.getDate() - 4);
      setCustomRange(desde, hoy);
    } else if (key === "14d") {
      select.value = "14d";
      chartRange = "14d";
      fromInput.value = "";
      toInput.value = "";
    } else if (key === "1m") {
      select.value = "30d";
      chartRange = "30d";
      fromInput.value = "";
      toInput.value = "";
    } else if (key === "1y") {
      desde.setFullYear(desde.getFullYear() - 1);
      setCustomRange(desde, hoy);
    } else if (key === "5y") {
      desde.setFullYear(desde.getFullYear() - 5);
      setCustomRange(desde, hoy);
    } else if (key === "max") {
      setCustomRange(inicioMaximoDisponible(), hoy);
    }

    if (customBox) {
      customBox.classList.add("hidden");
    }

    actualizarBotones();

    if (recargar) {
      loadStats();
    }
  }

  select.classList.add("activity-range-source");
  controls.classList.add("activity-period-controls");
  controls.replaceChildren(select);

  periodos.forEach((periodo) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "activity-period-btn";
    button.dataset.range = periodo.key;
    button.textContent = periodo.label;
    button.title = periodo.title;
    button.setAttribute("aria-label", periodo.title);
    button.addEventListener("click", () => aplicarPeriodo(periodo.key, true));
    controls.appendChild(button);
  });

  actualizarBotones();

  syncChartWithMainFilter = function syncChartWithMainFilterPeriodoActivo() {
    // La búsqueda principal puede cambiar fecha, palabra o número sin quitar
    // el periodo elegido específicamente para la gráfica.
    aplicarPeriodo(window.__activityRangeKey || "14d", false);
  };

  clearFilters = function clearFiltersConPeriodoActividad() {
    window.__activityRangeKey = "14d";
    clearFiltersBase();
    actualizarBotones();
  };

  updateActivityTitle = function updateActivityTitleMercado(data) {
    const title = document.getElementById("activityTitle");
    const sub = document.getElementById("activitySub");

    if (!title || !sub) {
      updateActivityTitleBase(data);
      return;
    }

    const labels = {
      "1d": "Actividad diaria — hoy",
      "5d": "Actividad diaria — últimos 5 días",
      "14d": "Actividad diaria — últimos 14 días",
      "1m": "Actividad diaria — último mes",
      "1y": "Actividad diaria — último año",
      "5y": "Actividad diaria — últimos 5 años",
      max: "Actividad diaria — histórico completo",
    };

    title.textContent = labels[window.__activityRangeKey] || "Actividad diaria";

    if (data?.chartMeta?.desde && data?.chartMeta?.hasta) {
      sub.textContent = `Interacciones del ${data.chartMeta.desde} al ${data.chartMeta.hasta}`;
    } else {
      sub.textContent = "Interacciones registradas según el periodo seleccionado";
    }
  };

  renderCharts = function renderChartsConTooltipActividad(data) {
    renderChartsBase(data);

    if (!lineChart || !Array.isArray(data?.actividadPorDia)) {
      return;
    }

    const actividad = data.actividadPorDia;
    const muchosPuntos = actividad.length > 45;

    lineChart.options.interaction = {
      mode: "index",
      intersect: false,
    };

    lineChart.options.hover = {
      mode: "index",
      intersect: false,
    };

    lineChart.options.animation = actividad.length > 180 ? false : undefined;

    if (lineChart.options.scales?.x?.ticks) {
      lineChart.options.scales.x.ticks.autoSkip = true;
      lineChart.options.scales.x.ticks.maxTicksLimit = 8;
      lineChart.options.scales.x.ticks.maxRotation = 0;
    }

    const dataset = lineChart.data.datasets?.[0];
    if (dataset) {
      dataset.pointRadius = muchosPuntos ? 0 : 4;
      dataset.pointHoverRadius = 5;
      dataset.pointHitRadius = muchosPuntos ? 10 : 6;
    }

    lineChart.options.plugins.tooltip = {
      displayColors: false,
      backgroundColor: isLight ? "rgba(255,255,255,.97)" : "rgba(15,23,42,.97)",
      titleColor: isLight ? "#122033" : "#f8fafc",
      bodyColor: isLight ? "#334155" : "#dbeafe",
      borderColor: isLight ? "rgba(37,99,235,.18)" : "rgba(96,165,250,.22)",
      borderWidth: 1,
      padding: 11,
      cornerRadius: 10,
      callbacks: {
        title(items) {
          const index = items?.[0]?.dataIndex ?? -1;
          const punto = actividad[index];
          return punto?.fecha || punto?.label || "";
        },
        label(context) {
          const value = Number(context.raw || 0);
          return `Interacciones: ${formatNumber(value)}`;
        },
        afterLabel(context) {
          const index = Number(context.dataIndex || 0);
          if (index <= 0) return "Inicio del periodo";

          const actual = Number(actividad[index]?.total || 0);
          const anterior = Number(actividad[index - 1]?.total || 0);
          const diferencia = actual - anterior;
          const signo = diferencia > 0 ? "+" : "";
          const flecha = diferencia > 0 ? "▲" : diferencia < 0 ? "▼" : "•";

          if (anterior <= 0) {
            return `${flecha} Variación: ${signo}${formatNumber(diferencia)}`;
          }

          const porcentaje = (diferencia / anterior) * 100;
          const pctSigno = porcentaje > 0 ? "+" : "";

          return `${flecha} Variación: ${signo}${formatNumber(diferencia)} (${pctSigno}${porcentaje.toFixed(1)}%)`;
        },
      },
    };

    lineChart.update("none");
  };
})();

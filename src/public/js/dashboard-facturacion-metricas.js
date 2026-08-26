"use strict";

(function protegerMetricasFacturacionFiltradas() {
  if (typeof cargarMetricasCertificados !== "function") return;

  const cargarMetricasOriginal = cargarMetricasCertificados;

  cargarMetricasCertificados = async function cargarMetricasCertificadosConFiltro() {
    const modoEmpresa =
      document.getElementById("searchMode")?.value === "empresa";
    const panelEmpresa = document.getElementById("empresaPanel");
    const panelVisible = panelEmpresa && !panelEmpresa.classList.contains("hidden");

    if (modoEmpresa && panelVisible) {
      actualizarMetricasCertificadosDesdeUsuarios(usuariosEmpresaFiltrados);
      return;
    }

    return cargarMetricasOriginal();
  };

  const searchMode = document.getElementById("searchMode");
  const qInput = document.getElementById("qInput");

  function actualizarAyudaTodasEmpresas() {
    if (!searchMode || !qInput) return;

    if (searchMode.value === "empresa") {
      qInput.placeholder =
        "Ej: TODOS, LIVING NATURAL, TEMPORARY PROFESSIONAL SERVICES SAS";
      qInput.title =
        "Escribe TODOS para consultar todas las empresas o escribe una o varias empresas separadas por coma.";
    } else {
      qInput.title = "";
    }
  }

  searchMode?.addEventListener("change", actualizarAyudaTodasEmpresas);
  actualizarAyudaTodasEmpresas();
})();

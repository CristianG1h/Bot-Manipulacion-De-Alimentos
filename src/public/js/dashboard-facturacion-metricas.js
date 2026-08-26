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
})();

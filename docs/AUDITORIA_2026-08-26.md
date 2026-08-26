# Auditoría técnica — 26 de agosto de 2026

## Alcance

Revisión del árbol completo del repositorio `Bot-Manipulacion-De-Alimentos`, sus rutas Express, servicios, dashboard, pruebas, assets, configuración y documentación.

## Hallazgos corregidos

### 1. Facturación visible fuera del modo empresa

El selector `Facturado` se creaba siempre y únicamente quedaba deshabilitado en el modo `Bot / interacciones`.

**Corrección:** el campo completo queda oculto en modo Bot y solamente aparece cuando `Buscar en = Empresa / usuarios curso`.

### 2. Duplicación del scraping administrativo

Existían dos implementaciones independientes:

- `adminCertificados.js`
- `adminFacturacion.js`

Ambas iniciaban sesión, scrapeaban el mismo panel, mantenían cachés independientes y enriquecían nombres.

**Corrección:** todo quedó consolidado en `adminCertificados.js`, con una sola caché y un solo parser.

### 3. Parser antiguo incompatible con la tabla actual

La ruta anterior de certificados exigía al menos 12 columnas y usaba posiciones fijas, mientras el panel actual tiene 11 columnas principales.

**Corrección:** el parser ahora identifica columnas por su encabezado (`EMPRESA`, `FACTURADO`, `CERTIFICADO`, `COMPLETADO`, etc.) y conserva fallbacks controlados.

### 4. Validación incompleta de celulares salientes

Los endpoints de acceso y certificado permitían saltarse `normalizeCOCell()` cuando el valor ya empezaba por `57` o `+57`.

**Corrección:** todos los destinatarios pasan siempre por la misma validación de celular colombiano.

### 5. Caché de nombres con trabajo repetido

La tabla PostgreSQL de caché se verificaba/creaba en cada lectura y escritura.

**Corrección:** la inicialización se comparte mediante una única Promise y la advertencia por configuración ausente se registra una sola vez.

### 6. Código y archivos sin uso

Se eliminaron:

- `TEMP_UNUSED_MARKER.txt`;
- `tmp/inspect/*`;
- `src/routes/adminFacturacion.js`;
- bundles antiguos de `company-documents-bundle`;
- copias Base64 antiguas de `company-documents-public`;
- empaquetados antiguos de `company-documents-secure`;
- loader y assets duplicados de custodia que ya no eran usados por `custodiaService`.

La fuente activa de Documentos VIP continúa siendo exclusivamente:

`src/assets/company-documents-live/`

### 7. Dependencia sin uso

`pdfkit` permanecía declarado aunque los PDFs productivos ya se generan mediante Chrome/Puppeteer.

**Corrección:** se retiró de `package.json`.

### 8. Higiene del repositorio

Se agregaron:

- `.gitignore`;
- `.env.example` sin secretos;
- pruebas de validación de celulares;
- CI con validación de sintaxis y pruebas;
- documentación actualizada.

### 9. Endurecimiento HTTP

Se deshabilitó `X-Powered-By` y se agregaron cabeceras básicas:

- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: SAMEORIGIN`;
- `Referrer-Policy: no-referrer`.

El endpoint `/health` también se normalizó a una respuesta JSON profesional.

## Hallazgo de mantenimiento: package-lock

El `package-lock.json` versionado estaba desalineado con `package.json`: el lockfile declaraba Node 20 y no reflejaba dependencias productivas actuales como Puppeteer.

La CI de esta auditoría usa temporalmente `npm install` para producir un lockfile sincronizado. El lockfile generado debe incorporarse antes del merge final y, una vez sincronizado, la instalación reproducible vuelve a `npm ci`.

## Riesgo residual importante

El repositorio es público y `src/assets/company-documents-live/` contiene documentos empresariales que el bot necesita enviar. Mientras esos PDFs permanezcan versionados aquí, cualquier persona con acceso al repositorio público puede descargarlos.

No se eliminaron porque son parte activa del flujo de Documentos VIP. Si alguno debe ser confidencial, debe migrarse a almacenamiento privado y cargarse en tiempo de ejecución mediante credenciales/URL firmada.

## Validaciones esperadas

Antes de fusionar:

1. instalar dependencias y sincronizar lockfile;
2. ejecutar `npm run check`;
3. ejecutar `npm test`;
4. comprobar que el dashboard solo muestre `Facturado` en modo empresa;
5. comprobar búsqueda multiempresa con `Facturado = No`;
6. comprobar generación de certificados de Manipulación y Custodia;
7. comprobar envío de acceso por `/notify/access`.

# Integración WhatsApp: certificados de Manipulación y Custodia Clínica

Rama de trabajo: `feature/whatsapp-certificados-custodia`.

## Objetivo

Agregar un menú superior al bot actual y dos automatizaciones de certificados sin modificar el dashboard existente:

1. **Manipulación de Alimentos**
   - conserva el instructivo actual;
   - agrega descarga de certificado por cédula;
   - normaliza cédulas con puntos, espacios y guiones;
   - consulta el panel administrativo mediante Axios + sesión con cookies;
   - recupera nombre completo desde el formulario de edición y reutiliza la caché PostgreSQL existente;
   - intenta descargar un PDF directo y, si la página es HTML, genera el PDF con Chromium/Puppeteer;
   - sube el PDF a Meta desde memoria y lo envía como documento de WhatsApp;
   - no guarda el PDF en disco.

2. **Custodia Clínica**
   - solicita NIT sin DV;
   - consulta exclusivamente el catálogo autorizado exportado de BIOFILE;
   - conserva el DV, incluido el valor `0`;
   - permite búsqueda aproximada por razón social como respaldo;
   - confirma la empresa antes de emitir;
   - genera el certificado con la fecha actual en `America/Bogota`;
   - conserva el membrete y la firma del prototipo;
   - genera el PDF en memoria y lo envía por WhatsApp sin persistirlo.

## Timeout conversacional

Los flujos de descarga de certificado y custodia tienen un timeout de **30 minutos**. Al vencer, se elimina el estado en memoria y el usuario vuelve al menú principal.

El timeout del modo asesor de 5 minutos se conserva por separado.

## Nuevas variables opcionales

```env
CERTIFICADOS_PUBLIC_BASE_URL=https://vip-alimentos-qexynvtf7q-uc.a.run.app/certificado
CERTIFICADOS_BOT_CACHE_TTL_MS=300000
CERTIFICATE_MAX_PDF_BYTES=12582912
WHATSAPP_MAX_UPLOAD_BYTES=15728640
PDF_BROWSER_CONCURRENCY=2
PDF_NAV_TIMEOUT_MS=30000
PDF_ACTION_TIMEOUT_MS=15000
PUPPETEER_CACHE_DIR=/opt/render/project/src/.cache/puppeteer
# Solo si se desea usar un Chrome del sistema:
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

Las variables existentes `ADMIN_BASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_LOGIN_PATH`, `ADMIN_PANEL_PATH`, `ADMIN_USER_FIELD`, `ADMIN_PASS_FIELD` y `CERTIFICADOS_DATABASE_URL` se reutilizan.

## Archivos fuente de custodia

Se conserva una copia del Excel autorizado y del DOCX prototipo en `resources/custodia/`. También se conserva la V1.2 de terminal como respaldo técnico.

El runtime no lee el Excel en cada solicitud: usa `src/data/custodia/clientes.js`, generado a partir de ese archivo, para que la consulta por NIT sea inmediata.

## Pendiente antes de merge a producción

- ejecutar `npm install` para regenerar `package-lock.json` incluyendo Puppeteer;
- probar instalación de Chromium en el entorno de Render;
- ejecutar `npm test` y `npm run check`;
- probar una cédula real con certificado disponible desde WhatsApp;
- probar custodia con NIT cuyo DV sea `0`;
- validar visualmente el PDF final en móvil y escritorio;
- revisar logs y consumo de memoria de Chromium antes de fusionar con `main`.

No se debe fusionar esta rama con `main` hasta completar esas pruebas.

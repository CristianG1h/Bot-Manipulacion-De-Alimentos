<div align="center">

<img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white"/>
<img src="https://img.shields.io/badge/PostgreSQL-Persistencia-4169E1?style=for-the-badge&logo=postgresql&logoColor=white"/>
<img src="https://img.shields.io/badge/Render-Producción-46E3B7?style=for-the-badge&logo=render&logoColor=white"/>

# Bot WhatsApp — Manipulación de Alimentos

### VIP Salud Ocupacional

**Chatwoot · Meta Cloud API · Dashboard · Certificados · Custodia clínica · Documentos VIP**

</div>

> **Documentación revisada y consolidada: 26 de agosto de 2026.**

## Descripción

Aplicación Node.js que concentra la automatización de WhatsApp para el proceso de **Manipulación de Alimentos** de VIP Salud Ocupacional y servicios auxiliares asociados al mismo canal.

El proyecto integra:

- atención automática desde Chatwoot;
- envío directo por WhatsApp Cloud API;
- modo asesor humano;
- entrega de instructivos y accesos;
- certificados de Manipulación de Alimentos;
- certificados de Custodia Clínica;
- entrega de Documentos VIP en PDF;
- dashboard protegido con estadísticas;
- consulta por una o varias empresas;
- filtro de usuarios facturados y no facturados;
- sincronización diaria del catálogo de empresas desde BIOFILE;
- persistencia PostgreSQL para estadísticas y cachés.

## Arquitectura

```text
Usuario WhatsApp
      │
      ▼
Meta WhatsApp Cloud API
      │
      ▼
Chatwoot
      │ webhook
      ▼
Node.js / Express
      │
      ├── Flujo Manipulación de Alimentos
      ├── Documentos VIP
      ├── Certificado de Manipulación
      ├── Certificado de Custodia Clínica
      ├── Modo asesor humano
      ├── Estadísticas ───────────► PostgreSQL / memoria
      ├── Panel certificados ─────► plataforma administrativa
      └── Catálogo custodia ──────► BIOFILE
```

## Dashboard

Disponible en:

```text
/
/dashboard
```

El dashboard está protegido con **Basic Auth**. Los bots de previsualización social reciben una tarjeta pública genérica y no el panel administrativo.

### Filtros generales

En `Bot / interacciones` se puede buscar por número, palabra o evento y filtrar por fecha.

En `Empresa / usuarios curso` el campo principal cambia a búsqueda de empresas y habilita funcionalidades adicionales:

- admite **varias empresas en una sola consulta**;
- las empresas se pueden separar por coma, punto y coma, salto de línea o `|`;
- aparece el filtro **Facturado** únicamente en este modo;
- `Facturado` permite elegir `Todo`, `Sí` o `No`;
- la tabla muestra el estado de facturación;
- el Excel exportado conserva exactamente las empresas, fechas y estado de facturación filtrados.

Ejemplo:

```text
LIVING NATURAL, TEMPORARY PROFESSIONAL SERVICES SAS
```

con `Facturado = No` devuelve únicamente usuarios no facturados pertenecientes a cualquiera de esas empresas.

La información de `Facturado` se obtiene directamente de la columna **FACTURADO** del panel administrativo. El parser identifica las columnas por encabezado y no depende únicamente de posiciones fijas.

## Panel administrativo de certificados

Las consultas del dashboard están consolidadas en un solo módulo y una sola caché:

```text
GET /api/admin-certificados
GET /api/admin-certificados/empresa?q=EMPRESA&facturado=no
```

Características:

- caché de panel de 5 minutos;
- patrón single-flight para evitar scrapes simultáneos duplicados;
- fallback a la última caché si el sistema externo falla;
- lectura de columnas por encabezado;
- exclusión de cuentas administrativas tipo `NIT` en reportes de usuarios;
- enriquecimiento de nombre completo;
- caché persistente de nombres cuando existe `CERTIFICADOS_DATABASE_URL`;
- filtro por una o varias empresas;
- filtro `Sí / No / Todo` para facturación;
- filtros por fecha de ingreso.

## Certificados

### Manipulación de Alimentos

El servicio busca al estudiante en el panel administrativo y obtiene el certificado disponible. Cuando la fuente es HTML se genera el PDF mediante Chrome/Puppeteer; si existe un PDF directo, utiliza ese camino primero.

### Custodia Clínica

El certificado de custodia se genera con HTML autocontenido y Chrome/Puppeteer. El catálogo base está versionado y se complementa automáticamente con BIOFILE cuando las credenciales están configuradas.

La sincronización de BIOFILE:

- se ejecuta después del arranque;
- se repite por defecto cada 24 horas;
- conserva el catálogo anterior si BIOFILE devuelve información incompleta o falla;
- permite ejecución manual desde un endpoint protegido del dashboard.

## Documentos VIP

Los documentos activos que el bot entrega están en:

```text
src/assets/company-documents-live/
```

Nombres esperados:

```text
rut.pdf
camara_comercio.pdf
habilitacion_reps.pdf
licencia_medico_sst.pdf
bancolombia.pdf
davivienda.pdf
```

El bot carga el PDF local, lo sube temporalmente a Meta y lo envía como documento de WhatsApp.

> El repositorio es público. Los archivos colocados en esta carpeta también quedan públicamente accesibles en GitHub. No se deben versionar documentos que deban permanecer confidenciales.

## Estadísticas

Las estadísticas se almacenan en PostgreSQL cuando existe:

```env
DATABASE_URL=...
```

Sin esa variable, el bot continúa utilizando memoria como fallback, pero los datos se pierden tras reiniciar o desplegar.

El dashboard incluye, entre otras métricas:

- conversaciones;
- mensajes recibidos y enviados;
- accesos enviados;
- certificados enviados;
- activaciones de asesor;
- mensajes no reconocidos;
- duplicados;
- rate limit;
- errores de Meta;
- actividad diaria;
- últimas interacciones;
- palabras clave.

Las fechas del dashboard se trabajan con referencia a `America/Bogota`.

## Seguridad y estabilidad

El proyecto aplica actualmente:

- secretos mediante variables de entorno;
- Basic Auth para dashboard y APIs administrativas;
- API key para endpoints de notificación;
- filtrado de inbox de Chatwoot;
- token para el webhook cuando está configurado;
- normalización de celulares colombianos;
- deduplicación de webhooks;
- rate limiting por usuario;
- límites de tamaño para mensajes y archivos;
- escape de datos dinámicos utilizados en certificados HTML;
- enlaces HTTP/HTTPS validados antes de exponerlos en el dashboard;
- cabeceras HTTP básicas de endurecimiento (`nosniff`, `SAMEORIGIN`, `no-referrer`);
- logs de destinatarios enmascarados en el servicio de WhatsApp;
- fallbacks controlados ante indisponibilidad de PostgreSQL, panel administrativo o BIOFILE.

## Estructura principal

```text
Bot-Manipulacion-De-Alimentos/
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── docs/
├── tests/
└── src/
    ├── server.js
    ├── config.js
    ├── assets/
    │   └── company-documents-live/
    ├── data/
    │   └── custodia/
    ├── routes/
    │   ├── adminCertificados.js
    │   ├── certificate.js
    │   ├── chatwoot.js
    │   ├── menuDocuments.js
    │   └── notify.js
    ├── services/
    │   ├── biofileCustodiaSync.js
    │   ├── browserPdf.js
    │   ├── certificadosBotService.js
    │   ├── certificadosNameCache.js
    │   ├── custodiaService.js
    │   ├── manipulacionCertificateService.js
    │   ├── stats.js
    │   └── whatsapp.js
    ├── utils/
    │   ├── rateLimit.js
    │   └── validation.js
    └── public/
        ├── dashboard.html
        ├── css/dashboard.css
        └── js/
```

## Variables de entorno

Se incluye `.env.example` con el inventario operativo sin secretos. Las credenciales reales deben mantenerse únicamente en el proveedor de despliegue.

Grupos principales:

- WhatsApp: `TOKEN`, `PHONE_NUMBER_ID`, `GRAPH_VERSION`;
- dashboard: `DASHBOARD_USER`, `DASHBOARD_PASS`;
- Chatwoot: `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_INBOX_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_WEBHOOK_TOKEN`;
- notificaciones: `API_KEY_NOTIFY`;
- estadísticas: `DATABASE_URL`;
- certificados: `ADMIN_BASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, rutas/campos de login y `CERTIFICADOS_DATABASE_URL`;
- BIOFILE: `BIOFILE_USER`, `BIOFILE_PASSWORD` y parámetros opcionales de sincronización;
- PDF: límites y timeouts opcionales documentados en `.env.example`.

## Endpoints principales

| Método | Endpoint | Uso |
|---|---|---|
| `GET` | `/` | Preview público para bots o dashboard protegido |
| `GET` | `/dashboard` | Dashboard protegido |
| `GET` | `/health` | Estado básico del servicio |
| `GET` | `/api/stats` | Estadísticas filtrables |
| `GET` | `/api/admin-certificados` | Métricas del panel administrativo |
| `GET` | `/api/admin-certificados/empresa` | Usuarios por empresa, fecha y facturación |
| `GET` | `/api/custodia-sync-status` | Estado de sincronización BIOFILE |
| `POST` | `/api/custodia-sync-now` | Sincronización manual BIOFILE |
| `POST` | `/chatwoot/webhook` | Entrada principal desde Chatwoot |
| `POST` | `/notify/access` | Enviar acceso al curso |
| `POST` | `/api/notify/access` | Alias de acceso |
| `POST` | `/notify/certificate` | Enviar certificado |
| `POST` | `/certificate` | Alias de certificado |

## Validación antes de desplegar

```bash
npm ci
npm run check
npm test
```

También existe un workflow de GitHub Actions que ejecuta estas validaciones en pull requests y cambios a `main`.

## Criterio de mantenimiento

- No versionar archivos temporales en `tmp/`.
- No copiar documentos en carpetas paralelas; la fuente activa es `company-documents-live`.
- No duplicar el scraping del panel administrativo: certificados y facturación comparten `adminCertificados.js`.
- Cualquier cambio de columnas del panel externo debe cubrirse con pruebas sintéticas.
- Antes de fusionar cambios de producción, ejecutar `npm run check` y `npm test`.

---

<div align="center">

**VIP Salud Ocupacional — Bogotá, Colombia**

</div>

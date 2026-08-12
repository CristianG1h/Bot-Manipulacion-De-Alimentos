<div align="center">

<img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white"/>
<img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white"/>
<img src="https://img.shields.io/badge/PostgreSQL-Persistencia-4169E1?style=for-the-badge&logo=postgresql&logoColor=white"/>
<img src="https://img.shields.io/badge/Render-Producción-46E3B7?style=for-the-badge&logo=render&logoColor=white"/>

# Bot WhatsApp — Manipulación de Alimentos

### VIP Salud Ocupacional

**En producción · Chatwoot · Meta Cloud API · Dashboard · Certificados · PostgreSQL · Modo asesor**

</div>

> **Documentación revisada y consolidada: 12 de agosto de 2026.**

## Descripción

Bot automatizado para atender por WhatsApp a los usuarios del **Curso de Manipulación de Alimentos** de VIP Salud Ocupacional.

El sistema funciona como primer punto de contacto: responde saludos, entrega instructivo y acceso al curso, registra eventos operativos, deriva conversaciones a un asesor humano cuando es necesario y permite consultar métricas desde un dashboard protegido.

Además incorpora un panel de consulta de certificados por empresa con caché para reducir llamadas al sistema externo.

## Arquitectura

```text
Usuario WhatsApp
      │
      ▼
Meta Cloud API
      │
      ▼
Chatwoot
      │ webhook
      ▼
Render - Node.js / Express
      │
      ├── Respuestas WhatsApp vía Graph API
      ├── Notas privadas en Chatwoot
      ├── Modo asesor humano
      ├── Anti-spam y deduplicación
      ├── Estadísticas ─────────────► PostgreSQL / memoria
      └── Consulta certificados
               │
               ├── caché compartida
               └── panel administrativo externo

Dashboard protegido: / y /dashboard
```

Chatwoot actúa como bandeja de atención y como origen del webhook. Las respuestas automáticas se envían directamente a WhatsApp mediante Meta Graph API.

## Flujo del usuario

```text
Usuario escribe
     │
     ▼
Bot detecta saludo o intención
     │
     ├── Instructivo / acceso al curso
     │        │
     │        └── usuario confirma recepción
     │                └── recomendación de completar el curso
     │
     └── Hablar con asesor
              │
              └── bot se pausa
                    │
                    └── asesor continúa desde Chatwoot
```

Si el bot no reconoce el mensaje, puede derivar la conversación al modo asesor para evitar respuestas incorrectas.

## Funcionalidades actuales

### Respuesta automática

- Detecta saludos.
- Presenta menú interactivo.
- Entrega instructivo y enlace del curso.
- Reconoce palabras relacionadas con acceso, usuario, contraseña, curso y certificado.
- Reconoce confirmaciones como `recibido`.
- Puede recordar al usuario completar el proceso dentro del tiempo recomendado.

### Modo asesor humano

- Al solicitar asesor, el bot se silencia para no competir con la atención humana.
- El asesor continúa desde Chatwoot.
- La actividad del usuario reinicia el temporizador para no interrumpir una conversación activa.
- Si no existe respuesta humana, el bot puede retomar después del período configurado.
- Cuando el asesor ya respondió, el bot puede reactivarse después de un período de inactividad.

### Integración Chatwoot

- Filtra el webhook por `CHATWOOT_INBOX_ID` para atender solamente el inbox correcto.
- Puede buscar o crear contacto y conversación cuando se envían notificaciones.
- Deja notas privadas de los principales eventos del bot.
- Las notas no deben incluir contraseñas ni credenciales del curso.
- Permite mantener trazabilidad sin enviar mensajes internos al usuario final.

### Notificaciones salientes

Endpoints disponibles para automatizaciones externas:

- `POST /notify/access`
- `POST /api/notify/access`
- `POST /notify/certificate`
- `POST /certificate`

El flujo de acceso utiliza la plantilla configurada para entregar las credenciales del curso. El flujo de certificado utiliza la plantilla aprobada correspondiente.

## Dashboard administrativo

Disponible en:

```text
/
/dashboard
```

El panel real está protegido mediante **Basic Auth**.

Cuando el enlace es leído por un bot de previsualización de WhatsApp, Facebook, Twitter u otra red compatible, se muestra una tarjeta pública genérica en lugar de exponer la información administrativa.

El dashboard incluye:

- conversaciones;
- mensajes recibidos;
- mensajes enviados;
- accesos enviados;
- certificados enviados;
- activaciones de asesor;
- mensajes no reconocidos;
- duplicados;
- bloqueos por rate limit;
- errores de Meta;
- actividad por fecha;
- últimas interacciones;
- búsqueda por número/palabra/evento;
- filtros por hoy, 7 días, 30 días y rango personalizado;
- ranking de palabras frecuentes;
- fechas y horas referenciadas a Bogotá.

## Persistencia

Las estadísticas pueden almacenarse en PostgreSQL mediante:

```env
DATABASE_URL=...
```

Si no existe esa variable, el sistema conserva un **fallback en memoria** para continuar operando, aunque la información no persiste después de un reinicio o despliegue.

## Panel de certificados por empresa

El bot incorpora una integración administrativa que consulta el sistema externo del curso mediante `axios`, cookies y `cheerio`.

### Optimización actual

- Caché en memoria de aproximadamente 5 minutos.
- Patrón **single-flight**: varias consultas simultáneas esperan la misma actualización y no lanzan múltiples scrapes duplicados.
- Si el sistema externo falla, se puede utilizar la última copia conocida como caché desactualizada en lugar de romper el dashboard.
- El frontend evita actualizar agresivamente cuando la pestaña no está visible.
- La actualización general se realiza con un intervalo más conservador para reducir carga.
- Búsqueda por empresa.
- Filtro por fecha de ingreso.
- Recuperación y enriquecimiento con nombre completo cuando está disponible.
- Caché persistente de nombres mediante `CERTIFICADOS_DATABASE_URL` cuando está configurada.

## Anti-spam y deduplicación

- Límite operativo aproximado de **8 mensajes por minuto por usuario**.
- Bloqueo temporal si se supera el límite.
- Longitud máxima controlada para mensajes entrantes.
- Deduplicación para evitar procesar reintentos del mismo webhook.
- La deduplicación se evalúa de forma que un reintento no consuma innecesariamente el límite de mensajes.

## Mejoras de estabilidad y seguridad consolidadas

Durante las revisiones de julio de 2026 se corrigieron varios puntos importantes:

- las estadísticas de salida se alinearon con mensajes realmente aceptados por Meta;
- se corrigió el funcionamiento cuando PostgreSQL no está disponible;
- se ajustó el orden entre deduplicación y rate limiting;
- se redujo el registro innecesario de información sensible en logs;
- se reforzó el modo asesor para que el bot realmente se pause durante atención humana;
- se corrigieron incompatibilidades de dependencias;
- se endureció la protección del webhook cuando falta configuración crítica;
- se corrigieron filtros de fecha del dashboard;
- se reforzó el dashboard frente a contenido no confiable para reducir riesgo de XSS;
- se redujo la frecuencia de trabajo del panel de certificados;
- se mejoró la confirmación del envío de accesos.

## Tecnologías

| Tecnología | Uso |
|---|---|
| Node.js 24.x | Runtime |
| Express 4.x | Servidor HTTP |
| Meta WhatsApp Cloud API | Envío de mensajes |
| Chatwoot | Inbox, asesores y trazabilidad |
| PostgreSQL (`pg`) | Estadísticas y cachés persistentes |
| Axios | Peticiones HTTP |
| axios-cookiejar-support | Sesiones HTTP del panel externo |
| tough-cookie | Manejo de cookies |
| Cheerio | Parseo del panel de certificados |
| Render | Hosting |
| GitHub | Control de versiones |

## Estructura principal

```text
Bot-Manipulacion-De-Alimentos/
├── package.json
├── package-lock.json
└── src/
    ├── server.js
    ├── config.js
    ├── routes/
    │   ├── chatwoot.js
    │   ├── notify.js
    │   ├── certificate.js
    │   └── adminCertificados.js
    ├── services/
    │   ├── whatsapp.js
    │   ├── stats.js
    │   └── certificadosNameCache.js
    ├── utils/
    │   ├── rateLimit.js
    │   └── validation.js
    └── public/
        ├── dashboard.html
        ├── css/
        └── js/
```

## Variables de entorno

### WhatsApp / curso

| Variable | Uso |
|---|---|
| `WHATSAPP_TOKEN` | Token de Meta |
| `PHONE_NUMBER_ID` | ID del número de WhatsApp |
| `COURSE_LINK` | Enlace del curso |
| `COURSE_PASSWORD` | Contraseña utilizada por el flujo de acceso |
| `VERIFY_TOKEN` | Token de verificación/configuración |
| `GRAPH_VERSION` | Versión de Graph API |

### Chatwoot

| Variable | Uso |
|---|---|
| `CHATWOOT_BASE_URL` | URL de Chatwoot |
| `CHATWOOT_API_TOKEN` | Token de API |
| `CHATWOOT_ACCOUNT_ID` | Cuenta |
| `CHATWOOT_INBOX_ID` | Inbox permitido |
| `CHATWOOT_WEBHOOK_TOKEN` | Protección del webhook |

### Dashboard / notificaciones

| Variable | Uso |
|---|---|
| `API_KEY_NOTIFY` | Protección de endpoints de notificación |
| `DASHBOARD_USER` | Usuario del dashboard |
| `DASHBOARD_PASS` | Contraseña del dashboard |
| `DATABASE_URL` | PostgreSQL de estadísticas |

### Certificados

| Variable | Uso |
|---|---|
| `ADMIN_BASE_URL` | URL del panel externo |
| `ADMIN_USERNAME` | Usuario administrativo |
| `ADMIN_PASSWORD` | Contraseña administrativa |
| `ADMIN_LOGIN_PATH` | Ruta de login |
| `ADMIN_PANEL_PATH` | Ruta del panel |
| `ADMIN_USER_FIELD` | Nombre del campo usuario |
| `ADMIN_PASS_FIELD` | Nombre del campo contraseña |
| `CERTIFICADOS_DATABASE_URL` | PostgreSQL para caché de nombres |

### Servidor

```env
PORT=3000
```

Las credenciales deben configurarse en **Render → Environment** y nunca escribirse directamente en este README o dentro del código versionado.

## Endpoints

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | Preview público para bots o dashboard protegido. |
| `GET` | `/dashboard` | Dashboard protegido. |
| `GET` | `/health` | Health check. |
| `GET` | `/api/stats` | Estadísticas filtrables. |
| `GET` | `/api/admin-certificados` | Resumen del panel de certificados. |
| `GET` | `/api/admin-certificados/empresa?q=` | Consulta por empresa. |
| `GET` | `/chatwoot/webhook` | Verificación del webhook. |
| `POST` | `/chatwoot/webhook?token=...` | Entrada principal desde Chatwoot. |
| `POST` | `/notify/access` | Enviar acceso al curso. |
| `POST` | `/api/notify/access` | Alias de acceso. |
| `POST` | `/notify/certificate` | Enviar certificado. |
| `POST` | `/certificate` | Alias de certificado. |

## Seguridad

- Tokens únicamente en variables de entorno.
- Dashboard protegido con Basic Auth.
- Webhook protegido mediante token.
- Filtrado estricto por inbox.
- Endpoints de notificación protegidos mediante API key.
- Anti-spam y deduplicación por usuario/mensaje.
- Normalización de números colombianos.
- Logs con información sensible reducida o enmascarada.
- Notas privadas sin credenciales.
- Fallback controlado cuando servicios externos están temporalmente fuera de línea.

## Estado

| Componente | Estado |
|---|---|
| Bot WhatsApp | Activo |
| Integración Chatwoot | Activa |
| Modo asesor | Activo |
| Notas privadas | Activas |
| Dashboard | Activo |
| Panel de certificados | Activo |
| PostgreSQL | Activo cuando está configurado; fallback en memoria disponible |
| Anti-spam | Activo |
| Deduplicación | Activa |
| Notificaciones de acceso/certificado | Activas |

---

<div align="center">

**Cristian Guarín**  
VIP Salud Ocupacional — Bogotá, Colombia

</div>

<div align="center">

<img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=node.js&logoColor=white"/>
<img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white"/>
<img src="https://img.shields.io/badge/PostgreSQL-Persistencia-4169E1?style=for-the-badge&logo=postgresql&logoColor=white"/>
<img src="https://img.shields.io/badge/Render-Deployed-46E3B7?style=for-the-badge&logo=render&logoColor=white"/>

# 🤖 Bot WhatsApp — VIP Salud Ocupacional

### Asistente automatizado para el *Curso de Manipulación de Alimentos*

🟢 En producción &nbsp;|&nbsp; 🟢 Estable &nbsp;|&nbsp; 🟢 Dashboard con métricas &nbsp;|&nbsp; 🟢 Anti-spam activo &nbsp;|&nbsp; 🟢 Modo asesor humano

</div>

---

## 📋 Descripción

Chatbot automatizado para **VIP Salud Ocupacional** que atiende a los usuarios del Curso de Manipulación de Alimentos directamente por WhatsApp.

El bot funciona como primer punto de contacto: responde saludos, entrega el instructivo y enlace del curso, confirma la recepción del acceso, y cuando el usuario necesita atención personalizada **silencia el bot y deja que un asesor humano tome el control** desde Chatwoot.

Además, el proyecto incluye un **dashboard web protegido** con métricas en tiempo real, un **panel de consulta de certificados** por empresa (con caché del panel y caché persistente de nombres) y **notas privadas automáticas en Chatwoot** para dejar trazabilidad de los principales flujos enviados por el bot.

---

## 🏗️ Arquitectura
```
Usuario WhatsApp
      ↓
Meta Cloud API
      ↓
Chatwoot  ──────────────→  /chatwoot/webhook  (Render)
                                   ↓
                         Servidor Node.js (Express)
                                   ↓
                ┌──────────────────┼──────────────────────────┐
                ↓                  ↓                           ↓
     Responde directo      PostgreSQL (stats +       Caché panel certificados
     vía Graph API         eventos del bot)           en memoria (TTL 5 min)
                                                               ↓
                                                  Scraping controlado del panel
                                                  externo (axios + cheerio)
                                   ↓
                         Dashboard web (/, /dashboard)
                         protegido con Basic Auth
```

> **Chatwoot** actúa como puente de entrada del webhook y también recibe notas privadas automáticas de lo que el bot respondió.
> Las respuestas al usuario van **directamente** a WhatsApp vía Meta Graph API.
> Las estadísticas y eventos del bot se guardan en **PostgreSQL** (con *fallback* a memoria si `DATABASE_URL` no está configurada). El panel de certificados usa una caché compartida en memoria de 5 minutos y los nombres completos pueden persistirse en una base separada mediante `CERTIFICADOS_DATABASE_URL`.
> El dashboard es una URL **camuflada**: si detecta que quien la visita es un bot de previsualización (WhatsApp, Facebook, Twitter, etc.) muestra una tarjeta pública genérica; a cualquier otra visita le exige usuario y contraseña.

---

## 🔄 Flujo del Usuario
```
1. Usuario escribe al número empresarial
        ↓
2. Bot detecta saludo → muestra menú interactivo
        ↓
   ┌─────────────────────┬──────────────────────┐
   │  📄 Instructivo     │  💬 Hablar con asesor │
   └─────────────────────┴──────────────────────┘
        ↓                         ↓
3. Bot envía el          4. Bot se SILENCIA
   instructivo y            Asesor humano
   link del curso           toma el control
        ↓                    en Chatwoot
4b. Si el usuario                ↓
   confirma "recibido"    5. Si en 5 min no hay
   el bot envía una          respuesta humana,
   recomendación de           el bot retoma
   completarlo en 24h        automáticamente
```

---

## ✨ Funcionalidades

### 🤖 Respuesta automática
- Detecta saludos y muestra el menú con botones interactivos
- Envía el instructivo y link del curso al instante
- Reconoce palabras clave: `instructivo`, `link`, `enlace`, `curso`, `acceso`, `contraseña`, `clave`, `usuario`, `certificado`
- Reconoce confirmaciones tipo `recibido` / `ok recibido` y responde con una recomendación de completar el curso en 24 horas

### 👤 Modo asesor humano
- Al presionar **"Hablar con asesor"** (o al enviar un mensaje que el bot no reconoce) el bot se silencia completamente
- El asesor puede escribir libremente desde Chatwoot
- Si el usuario sigue escribiendo, el timer se reinicia (no interrumpe al asesor)
- Si el asesor nunca responde, después de **5 minutos** el bot retoma automáticamente con un mensaje de disculpa y opciones
- Si el asesor ya respondió, el bot retoma silenciosamente después de **5 minutos sin actividad**

### 📝 Notas privadas automáticas en Chatwoot
- Las respuestas principales del bot (menú, instructivo, confirmación y derivación a asesor) se registran como **nota privada** en la conversación de Chatwoot cuando el envío fue aceptado correctamente
- Al enviar el acceso al curso (`/notify/access`) el bot busca o crea automáticamente el contacto y la conversación en Chatwoot y deja constancia de lo enviado
- Nunca se guardan credenciales ni contraseñas en las notas — solo confirmación de que fueron enviadas por WhatsApp

### 🎯 Filtrado por inbox
- El webhook solo procesa mensajes del inbox configurado en `CHATWOOT_INBOX_ID`, ignorando cualquier otro inbox conectado a la misma instancia de Chatwoot

### 🛡️ Protección anti-spam
- Límite de **8 mensajes por minuto** por usuario
- Bloqueo temporal de **5 minutos** si se excede el límite
- Longitud máxima de mensaje: **500 caracteres**

### 🔁 Deduplicación en memoria
- Evita procesar el mismo mensaje dos veces (reintentos del webhook)
- Se limpia automáticamente cada **24 horas**

### 🔒 Protección del webhook
- El endpoint `/chatwoot/webhook` está protegido con token en la URL
- Requests sin token válido reciben `401 Unauthorized`

### 📊 Dashboard administrativo
- Disponible en `/` y `/dashboard`, protegido con **Basic Auth** (`DASHBOARD_USER` / `DASHBOARD_PASS`)
- A los bots de previsualización de WhatsApp/Facebook/Twitter/etc. se les muestra una tarjeta pública genérica en vez del panel real (para que el link se vea bien al compartirlo, sin exponer datos)
- Filtros por número, palabra clave o evento; por rango de fecha (hoy, 7d, 30d, personalizado)
- Métricas generales: mensajes recibidos/enviados, accesos, certificados, activaciones de asesor, no reconocidos, duplicados, rate limits, errores de Meta
- Gráfico de actividad por día, con navegación entre rangos
- Ranking de palabras clave más usadas por los usuarios
- Registro de últimas interacciones con hora en zona horaria de Bogotá

### 📇 Panel de consulta de certificados por empresa
- Se autentica automáticamente (scraping con `axios` + `cheerio`) contra el panel administrativo externo de la plataforma del curso
- Cachea la lista de usuarios/certificados en memoria por 5 minutos para no sobrecargar la plataforma externa
- Usa una sincronización compartida (*single-flight*): si varios navegadores consultan al mismo tiempo, esperan el mismo proceso en vez de lanzar scrapes duplicados
- Si la plataforma externa falla, sirve la última copia conocida (`cache_desactualizada: true`) en vez de romper el dashboard
- El frontend actualiza las métricas de certificados cada 60 segundos únicamente cuando la pestaña está visible
- Permite buscar usuarios por nombre de empresa y filtrar por fecha de ingreso usando la misma caché del panel
- Enriquece cada usuario con su **nombre completo real** y lo guarda en PostgreSQL para evitar consultas repetidas al panel de edición

### 📤 Notificaciones salientes
- **`/notify/access`** — Envía plantilla de acceso al curso (`acceso_curso1`) y deja nota privada en Chatwoot
- **`/notify/certificate`** y **`/certificate`** — Envían plantilla de certificado aprobado (`certificado_aprobado_v1`)

---

## ⚙️ Tecnologías

| Tecnología | Uso |
|---|---|
| **Node.js 24.x** | Runtime del servidor |
| **Express 4** | Framework HTTP |
| **WhatsApp Cloud API (Meta)** | Envío de mensajes |
| **Chatwoot** | Webhook de entrada, gestión de asesores y notas privadas |
| **PostgreSQL (`pg`)** | Persistencia de estadísticas, eventos y caché de nombres de certificados |
| **axios + axios-cookiejar-support + tough-cookie** | Cliente HTTP con sesión/cookies para el panel de certificados |
| **cheerio** | Scraping y parseo del HTML del panel administrativo externo |
| **Render** | Hosting en producción |
| **GitHub** | Control de versiones |

---

## 🗂️ Estructura del Proyecto
```
📦 Bot-Manipulacion-De-Alimentos
├── 📄 package.json
└── 📁 src
    ├── 📄 server.js                    ← Entrada principal, dashboard, previews OG
    ├── 📄 config.js                    ← Variables de entorno
    ├── 📁 routes
    │   ├── 📄 chatwoot.js              ← Webhook principal del bot ⭐
    │   ├── 📄 notify.js                ← Notificaciones de acceso + notas Chatwoot
    │   ├── 📄 certificate.js           ← Notificaciones de certificado
    │   └── 📄 adminCertificados.js     ← Scraping y API del panel de certificados
    ├── 📁 services
    │   ├── 📄 whatsapp.js              ← Envío a Graph API
    │   ├── 📄 stats.js                 ← Estadísticas + persistencia PostgreSQL
    │   └── 📄 certificadosNameCache.js ← Caché de nombres completos (PostgreSQL)
    ├── 📁 utils
    │   ├── 📄 rateLimit.js             ← Anti-spam
    │   └── 📄 validation.js            ← Normalización de teléfono
    └── 📁 public                       ← Dashboard web (protegido)
        ├── 📄 dashboard.html
        ├── 📁 css
        │   └── 📄 dashboard.css
        └── 📁 js
            └── 📄 dashboard.js
```

---

## 🔐 Variables de Entorno

Configura estas variables en **Render → Environment**:

### WhatsApp / Curso
| Variable | Descripción | Requerida |
|---|---|:---:|
| `WHATSAPP_TOKEN` | Token de acceso de Meta | ✅ |
| `PHONE_NUMBER_ID` | ID del número de WhatsApp | ✅ |
| `COURSE_LINK` | Link del curso | ✅ |
| `COURSE_PASSWORD` | Contraseña del curso | ✅ |
| `VERIFY_TOKEN` | Token reservado de verificación; actualmente requerido por `config.js` | ✅ |
| `GRAPH_VERSION` | Versión de Graph API (default: `v22.0`) | ⬜ |

### Chatwoot
| Variable | Descripción | Requerida |
|---|---|:---:|
| `CHATWOOT_BASE_URL` | URL de tu instancia Chatwoot | ✅ |
| `CHATWOOT_API_TOKEN` | Token API de Chatwoot | ✅ |
| `CHATWOOT_ACCOUNT_ID` | ID de cuenta en Chatwoot | ✅ |
| `CHATWOOT_INBOX_ID` | ID del inbox que debe atender el bot | ✅ |
| `CHATWOOT_WEBHOOK_TOKEN` | Token de seguridad del webhook | ✅ |

### Notificaciones y dashboard
| Variable | Descripción | Requerida |
|---|---|:---:|
| `API_KEY_NOTIFY` | Clave para endpoints de notificación (`x-api-key`) | ✅ |
| `DASHBOARD_USER` | Usuario para acceder al dashboard | ✅ |
| `DASHBOARD_PASS` | Contraseña del dashboard | ✅ |
| `DATABASE_URL` | Conexión PostgreSQL para estadísticas y eventos del bot | ⬜ (si falta, funciona en memoria) |

### Panel administrativo de certificados
| Variable | Descripción | Requerida |
|---|---|:---:|
| `ADMIN_BASE_URL` | URL base de la plataforma del curso | ✅ (para `/api/admin-certificados`) |
| `ADMIN_USERNAME` | Usuario admin de la plataforma del curso | ✅ |
| `ADMIN_PASSWORD` | Contraseña admin de la plataforma del curso | ✅ |
| `ADMIN_LOGIN_PATH` | Ruta de login (default: `/login`) | ⬜ |
| `ADMIN_PANEL_PATH` | Ruta del panel de usuarios (default: `/admin`) | ⬜ |
| `ADMIN_USER_FIELD` | Nombre del campo usuario en el form de login (default: `username`) | ⬜ |
| `ADMIN_PASS_FIELD` | Nombre del campo contraseña en el form de login (default: `password`) | ⬜ |
| `CERTIFICADOS_DATABASE_URL` | Conexión PostgreSQL para el caché de nombres completos | ⬜ (si falta, no se cachean nombres) |

### Servidor
| Variable | Descripción | Requerida |
|---|---|:---:|
| `PORT` | Puerto del servidor (default: `3000`) | ⬜ |

---

## 🌐 Endpoints disponibles

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | Preview público para bots de redes / Dashboard protegido para el resto |
| `GET` | `/dashboard` | Dashboard protegido (siempre pide Basic Auth) |
| `GET` | `/health` | Healthcheck público para Render/UptimeRobot |
| `GET` | `/api/stats` | Estadísticas del bot (protegido, admite filtros por query) |
| `GET` | `/api/admin-certificados` | Métricas generales del panel de certificados (protegido) |
| `GET` | `/api/admin-certificados/empresa?q=` | Búsqueda de usuarios por empresa (protegido) |
| `GET` | `/chatwoot/webhook` | Verificación Chatwoot |
| `POST` | `/chatwoot/webhook?token=XXX` | Entrada de mensajes ⭐ |
| `POST` | `/notify/access` | Enviar acceso al curso |
| `POST` | `/api/notify/access` | Alias para enviar acceso al curso |
| `POST` | `/notify/certificate` | Enviar certificado |
| `POST` | `/certificate` | Enviar certificado (alias) |

---

## 🛡️ Seguridad

- ✅ Tokens almacenados en variables de entorno (nunca en código)
- ✅ Variables críticas de WhatsApp y del curso validadas al arranque — el servidor no inicia si falta alguna de ellas
- ✅ Webhook protegido con token en URL (`CHATWOOT_WEBHOOK_TOKEN`)
- ✅ Webhook filtra mensajes por `CHATWOOT_INBOX_ID` para ignorar otros canales
- ✅ Dashboard y API de métricas protegidos con Basic Auth (`DASHBOARD_USER` / `DASHBOARD_PASS`)
- ✅ Bots de previsualización reciben una tarjeta pública sin datos reales; el panel real nunca queda expuesto en el link compartido
- ✅ Endpoints de notificación protegidos con `x-api-key`
- ✅ Prevención de mensajes duplicados (deduplicación en memoria)
- ✅ Protección anti-spam con rate limiting por usuario
- ✅ Validación y normalización de números colombianos (+57)
- ✅ Logs de envío a Meta enmascaran el número de destino y nunca imprimen el texto del mensaje ni credenciales
- ✅ Notas privadas de Chatwoot nunca incluyen contraseñas ni credenciales, solo confirmación de envío

---

## 🔮 Mejoras Futuras

- [ ] Notificaciones automáticas al finalizar el curso
- [ ] Integración directa con plataforma e-learning (sin scraping)
- [ ] Persistir también la caché completa del panel de certificados en PostgreSQL
- [ ] Generación automática de certificados
- [ ] Exportar reportes del dashboard (CSV/Excel)
- [ ] Soporte multi-curso y multi-sede
- [ ] Alertas automáticas ante errores repetidos de Meta

---

## 📌 Estado del Proyecto

| Item | Estado |
|---|---|
| Servidor en producción | 🟢 Activo |
| Bot respondiendo mensajes | 🟢 Activo |
| Modo asesor humano | 🟢 Activo |
| Notas privadas automáticas en Chatwoot | 🟢 Activo |
| Notificaciones salientes | 🟢 Activo |
| Protección webhook | 🟢 Activo |
| Dashboard administrativo | 🟢 Activo |
| Panel de consulta de certificados | 🟢 Activo |
| Persistencia en PostgreSQL | 🟢 Activo (con fallback a memoria) |
| Anti-spam | 🟢 Activo |

---

<div align="center">

## 👨‍💻 Autor

**Cristian Guarín**
Ingeniero en Sistemas
Bogotá, Colombia

---

*Desarrollado con ❤️ para VIP Salud Ocupacional*

</div>
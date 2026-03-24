<div align="center">
 
<img src="https://img.shields.io/badge/WhatsApp-Bot-25D366?style=for-the-badge&logo=whatsapp&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=node.js&logoColor=white"/>
<img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white"/>
<img src="https://img.shields.io/badge/Render-Deployed-46E3B7?style=for-the-badge&logo=render&logoColor=white"/>
 
# 🤖 Bot WhatsApp — VIP Salud Ocupacional
 
### Asistente automatizado para el *Curso de Manipulación de Alimentos*
 
🟢 En producción &nbsp;|&nbsp; 🟢 Estable &nbsp;|&nbsp; 🟢 Sin base de datos &nbsp;|&nbsp; 🟢 Anti-spam activo &nbsp;|&nbsp; 🟢 Modo asesor humano
 
</div>
 
---
 
## 📋 Descripción
 
Chatbot automatizado para **VIP Salud Ocupacional** que atiende a los usuarios del Curso de Manipulación de Alimentos directamente por WhatsApp.
 
El bot funciona como primer punto de contacto: responde saludos, entrega el instructivo y enlace del curso, y cuando el usuario necesita atención personalizada **silencia el bot y deja que un asesor humano tome el control** desde Chatwoot.
 
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
                     Responde directo vía Graph API
```
 
> **Chatwoot** actúa como puente de entrada del webhook.
> Las respuestas van **directamente** a WhatsApp vía Meta Graph API.
> No se usa base de datos — todo en memoria.
 
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
                            en Chatwoot
                                  ↓
                         5. Si en 5 min no hay
                            respuesta humana,
                            el bot retoma
                            automáticamente
```
 
---
 
## ✨ Funcionalidades
 
### 🤖 Respuesta automática
- Detecta saludos y muestra el menú con botones interactivos
- Envía el instructivo y link del curso al instante
- Reconoce palabras clave: `instructivo`, `link`, `enlace`, `curso`, `acceso`
 
### 👤 Modo asesor humano
- Al presionar **"Hablar con asesor"** el bot se silencia completamente
- El asesor puede escribir libremente desde Chatwoot
- Si el usuario sigue escribiendo, el timer se reinicia (no interrumpe al asesor)
- Después de **5 minutos sin respuesta humana**, el bot retoma automáticamente con un mensaje de disculpa y opciones
 
### 🛡️ Protección anti-spam
- Límite de **8 mensajes por minuto** por usuario
- Bloqueo temporal de **5 minutos** si se excede el límite
- Longitud máxima de mensaje: **500 caracteres**
 
### 🔁 Deduplicación en memoria
- Evita procesar el mismo mensaje dos veces (reintentos del webhook)
- Se limpia automáticamente cada **24 horas**
- Sin necesidad de base de datos

### 🔒 Protección del webhook
- El endpoint `/chatwoot/webhook` está protegido con token en la URL
- Requests sin token válido reciben `401 Unauthorized`
 
### 📤 Notificaciones salientes
- **`/notify/access`** — Envía plantilla de acceso al curso (`acceso_curso1`)
- **`/notify/certificate`** — Envía plantilla de certificado aprobado (`certificado_aprobado_v1`)
 
---
 
## ⚙️ Tecnologías
 
| Tecnología | Uso |
|---|---|
| **Node.js 20.x** | Runtime del servidor |
| **Express 4** | Framework HTTP |
| **WhatsApp Cloud API (Meta)** | Envío de mensajes |
| **Chatwoot** | Webhook de entrada + gestión de asesores |
| **Render** | Hosting en producción |
| **GitHub** | Control de versiones |
 
---
 
## 🗂️ Estructura del Proyecto
```
📦 Bot-Manipulacion-De-Alimentos
├── 📄 package.json
└── 📁 src
    ├── 📄 server.js          ← Entrada principal
    ├── 📄 config.js          ← Variables de entorno
    ├── 📁 routes
    │   ├── 📄 chatwoot.js    ← Webhook principal del bot ⭐
    │   ├── 📄 notify.js      ← Notificaciones de acceso
    │   └── 📄 certificate.js ← Notificaciones de certificado
    ├── 📁 services
    │   └── 📄 whatsapp.js    ← Envío a Graph API
    └── 📁 utils
        ├── 📄 rateLimit.js   ← Anti-spam
        └── 📄 validation.js  ← Normalización de teléfono
```
 
---
 
## 🔐 Variables de Entorno
 
Configura estas variables en **Render → Environment**:
 
| Variable | Descripción | Requerida |
|---|---|:---:|
| `WHATSAPP_TOKEN` | Token de acceso de Meta | ✅ |
| `PHONE_NUMBER_ID` | ID del número de WhatsApp | ✅ |
| `CHATWOOT_BASE_URL` | URL de tu instancia Chatwoot | ✅ |
| `CHATWOOT_API_TOKEN` | Token API de Chatwoot | ✅ |
| `CHATWOOT_ACCOUNT_ID` | ID de cuenta en Chatwoot | ✅ |
| `COURSE_LINK` | Link del curso | ✅ |
| `COURSE_PASSWORD` | Contraseña del curso | ✅ |
| `API_KEY_NOTIFY` | Clave para endpoints de notificación | ✅ |
| `VERIFY_TOKEN` | Token de verificación del webhook | ✅ |
| `CHATWOOT_WEBHOOK_TOKEN` | Token de seguridad del webhook | ✅ |
| `GRAPH_VERSION` | Versión de Graph API (default: `v22.0`) | ⬜ |
| `PORT` | Puerto del servidor (default: `3000`) | ⬜ |
 
---
 
## 🌐 Endpoints disponibles
 
| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | Healthcheck |
| `GET` | `/chatwoot/webhook` | Verificación Chatwoot |
| `POST` | `/chatwoot/webhook?token=XXX` | Entrada de mensajes ⭐ |
| `POST` | `/notify/access` | Enviar acceso al curso |
| `POST` | `/notify/certificate` | Enviar certificado |
| `POST` | `/certificate` | Enviar certificado (alias) |
 
---
 
## 🛡️ Seguridad
 
- ✅ Tokens almacenados en variables de entorno (nunca en código)
- ✅ Variables requeridas validadas al arranque — el servidor no inicia si falta alguna
- ✅ Webhook protegido con token en URL (`CHATWOOT_WEBHOOK_TOKEN`)
- ✅ Endpoints de notificación protegidos con `x-api-key`
- ✅ Prevención de mensajes duplicados (deduplicación en memoria)
- ✅ Protección anti-spam con rate limiting por usuario
- ✅ Validación y normalización de números colombianos (+57)
 
---
 
## 🔮 Mejoras Futuras
 
- [ ] Dashboard administrativo web
- [ ] Notificaciones automáticas al finalizar el curso
- [ ] Integración directa con plataforma e-learning
- [ ] Generación automática de certificados
- [ ] Métricas y reportes de atención
- [ ] Soporte multi-curso y multi-sede
 
---
 
## 📌 Estado del Proyecto
 
| Item | Estado |
|---|---|
| Servidor en producción | 🟢 Activo |
| Bot respondiendo mensajes | 🟢 Activo |
| Modo asesor humano | 🟢 Activo |
| Notificaciones salientes | 🟢 Activo |
| Protección webhook | 🟢 Activo |
| Base de datos | ⚪ No utilizada |
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

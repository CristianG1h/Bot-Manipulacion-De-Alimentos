<div align="center">
<h1>📘 Bot Manipulación de Alimentos – VIP Salud Ocupacional</h1>
</div>
<p></p>
<div align="center">
<h2>🚀 Descripción</h2>
</div>
<p></p>
Chatbot automatizado para el proceso de registro del Curso de Manipulación de Alimentos, desarrollado para VIP Salud Ocupacional.
<p></p>
El bot permite:
<p></p>
<ol>
  <li>Registro automatizado de usuarios vía WhatsApp</li>
  <li>Almacenamiento seguro en PostgreSQL</li>
  <li>Envío de instructivo y enlace del curso</li>
  <li>Manejo de sesiones por pasos</li>
  <li>Prevención de mensajes duplicados (Webhook retry protection)</li>
  <li>Envío de instructivo y enlace del curso</li>
  <li>Limpieza automática de eventos antiguos</li>
  <li>Despliegue en producción con Render</li>
  <li>Este sistema elimina la gestión manual y garantiza trazabilidad de los registros.</li>
</ol>
<p></p>
<div align="center">
<h2>🏗️ Arquitectura</h2>
</div>
<p></p>
flowchart TD
<p></p>
<div align="center">
  Usuario WhatsApp
      <p>↓</p>
  Meta Cloud API
      <p>↓</p>
  Webhook (Render)
      <p>↓</p>
  servidor Node.js (Express)
      <p>↓</p>
  PostgreSQL (Render DB)
</div>
<p></p>
<div align="center">
<h2>⚙️ Tecnologías Utilizadas</h2>
</div>
<p></p>
<ul>
  <li>Node.js 18+</li>
  <li>Express 5</li>
  <li>PostgreSQL</li>
  <li>Render (Hosting)</li>
  <li>WhatsApp Cloud API (Meta)</li>
  <li>GitHub (Control de versiones)</li>
  <li>Protección contra duplicados</li>
</ul>
<p></p>
<div align="center">
<h2>🔐 Variables de Entorno</h2>
</div>
<p></p>
El proyecto requiere las siguientes variables:
<p></p>
<ul>
  <li>VERIFY_TOKEN=vip_verify_123</li>
  <li>WHATSAPP_TOKEN=TU_TOKEN_DE_META</li>
  <li>PHONE_NUMBER_ID=TU_PHONE_NUMBER_ID</li>
  <li>DATABASE_URL=postgresql://usuario:password@host/database</li>
</ul>
<p></p>
<div align="center">
<h2>🧠 Funcionalidades Implementadas</h2>
</div>
<p></p>
<ol>

  <li>
    <strong>Registro por pasos</strong><br>
    El bot guía al usuario mediante flujo conversacional:
    <ul>
      <li>Nombre completo</li>
      <li>Cédula</li>
      <li>Celular</li>
      <li>Correo electrónico</li>
      <li>La sesión se almacena temporalmente en la tabla <code>sessions</code>.</li>
    </ul>
  </li>

  <li>
    <strong>Persistencia en PostgreSQL</strong><br>
    Tablas principales:
    <ul>
      <li><code>registrations</code> – Guarda el registro definitivo del usuario.</li>
      <li><code>sessions</code> – Controla el flujo conversacional.</li>
      <li><code>processed_messages</code> – Evita procesamiento duplicado de eventos Webhook.</li>
    </ul>
  </li>

  <li><strong>Envío de instructivo y enlace del curso</strong></li>

  <li><strong>Manejo de sesiones por pasos</strong></li>

  <li><strong>Prevención de mensajes duplicados (Webhook retry protection)</strong></li>

  <li>
    <strong>Limpieza automática de eventos antiguos</strong><br>
    Los IDs procesados se eliminan automáticamente después de 24 horas para evitar crecimiento innecesario de la base de datos.
  </li>

  <li><strong>Despliegue en producción con Render</strong></li>

  <li>
    Este sistema elimina la gestión manual y garantiza trazabilidad de los registros.
  </li>

</ol>
<div align="center">
<h2>🔄 Flujo del Usuario</h2>
</div>
<ol>
  <li>Usuario escribe al número empresarial.</li>
  <li>El bot muestra menú interactivo.</li>
  <li>El usuario selecciona "Registrarme".</li>
  <li>Se inicia flujo de captura de datos.</li>
  <li>Se guarda información en la base de datos.</li>
  <li>Se envía instructivo y enlace del curso.</li>
</ol>
<div align="center">
<h2>🛡️ Seguridad</h2>
</div>
<ol>
  <li>Tokens almacenados en variables de entorno.</li>
  <li>Conexión SSL a PostgreSQL.</li>
  <li>Validación de Webhook mediante <code>VERIFY_TOKEN</code>.</li>
  <li>Prevención de eventos duplicados.</li>
</ol>
<div align="center">
<h2>🔮 Mejoras Futuras</h2>
</div>
<ol>
  <li>Dashboard administrativo web</li>
  <li>Notificaciones automáticas al finalizar curso</li>
  <li>Integración directa con plataforma e-learning</li>
  <li>Generación automática de certificados</li>
  <li>Métricas y reportes</li>
  <li>Multi-curso y multi-sede</li>
</ol>
<div align="center">
<h2>📌 Estado del Proyecto</h2>
</div>
<p></p>
🟢 En producción
<p></p>
🟢 Estable
<p></p>
🟢 Base de datos persistente
<p></p>
🟢 Protección contra duplicados
<p></p>
<div align="center">
<h2>👨‍💻 Autor</h2>
<p></p>
Cristian Guarin
<p></p>
Ingeniero en Sistemas
<p></p>
Bogotá – Colombia
</div>
<p></p>


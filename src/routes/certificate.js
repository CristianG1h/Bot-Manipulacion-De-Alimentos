router.post("/certificate", requireApiKey, async (req, res) => {
  try {
    const { to, name, certificate_url } = req.body || {};

    if (!to) {
      return res.status(400).json({ ok: false, error: "Missing 'to'" });
    }

    if (!name || !certificate_url) {
      return res.status(400).json({ ok: false, error: "Missing name/certificate_url" });
    }

    // Normalización número Colombia
    const norm =
      String(to).startsWith("57") || String(to).startsWith("+57")
        ? { e164: String(to).startsWith("+") ? String(to) : `+${String(to)}` }
        : normalizeCOCell(String(to));

    if (!norm?.e164) {
      return res.status(400).json({ ok: false, error: "Invalid phone number" });
    }

    const waTo = norm.e164.replace("+", "");

    // ⚠️ CAMBIA ESTO por el nombre EXACTO de tu plantilla
    const TEMPLATE_NAME = "certificado_aprobado_v1"; 
    const LANG = "es_CO"; // o "es" según te aparezca en Meta

    const payload = {
      messaging_product: "whatsapp",
      to: waTo,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(name) },            // {{1}}
              { type: "text", text: String(certificate_url) }, // {{2}}
            ],
          },
        ],
      },
    };

    await sendPayload(payload);

    return res.json({ ok: true });
  } catch (error) {
    console.error("❌ notify/certificate error:", error);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
});

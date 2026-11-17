const { Resend } = require("resend");

function isConfigured() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.RESEND_FROM
  );
}

function getClient() {
  if (!isConfigured()) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendPasswordResetCode({
  to,
  fullName,
  code,
  expiresMinutes,
}) {
  const resend = getClient();

  const safeName =
    String(fullName || "Studente").trim() || "Studente";

  const safeNameHtml = escapeHtml(safeName);
  const safeCodeHtml = escapeHtml(code);

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM,
    to: [to],
    subject: "SmartStudy - Codice recupero password",

    text:
      `Ciao ${safeName},\n\n` +
      `il tuo codice SmartStudy per reimpostare la password è: ${code}\n\n` +
      `Il codice scade tra ${expiresMinutes} minuti.\n` +
      `Se non hai richiesto il recupero password, ignora questa email.\n\n` +
      `SmartStudy`,

    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">` +
      `<h2 style="color:#0B2239">SmartStudy</h2>` +
      `<p>Ciao ${safeNameHtml},</p>` +
      `<p>hai richiesto di reimpostare la password del tuo account.</p>` +
      `<p>Il tuo codice di verifica è:</p>` +
      `<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0B2239;margin:24px 0">` +
      `${safeCodeHtml}` +
      `</div>` +
      `<p>Il codice scade tra <strong>${expiresMinutes} minuti</strong>.</p>` +
      `<p>Se non hai richiesto il recupero password, puoi ignorare questa email.</p>` +
      `<p style="margin-top:30px;color:#718096">SmartStudy</p>` +
      `</div>`,
  });

  if (error) {
    console.error("RESEND EMAIL ERROR:", {
      name: error.name,
      message: error.message,
    });

    const err = new Error(
      error.message || "RESEND_SEND_FAILED"
    );

    err.code = "RESEND_SEND_FAILED";
    throw err;
  }

  console.log(
    "Password reset email inviata tramite Resend:",
    data?.id || "OK"
  );

  return data;
}

module.exports = {
  isConfigured,
  sendPasswordResetCode,
};
const nodemailer = require("nodemailer");

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function createTransporter() {
  if (!isConfigured()) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const port = Number(process.env.SMTP_PORT);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
    port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetCode({ to, fullName, code, expiresMinutes }) {
  const transporter = createTransporter();
  const safeName = fullName || "Studente";

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "SmartStudy - Codice recupero password",
    text:
      `Ciao ${safeName},\n\n` +
      `il tuo codice SmartStudy per reimpostare la password è: ${code}\n\n` +
      `Il codice scade tra ${expiresMinutes} minuti.\n` +
      `Se non hai richiesto il recupero password, ignora questa email.\n\n` +
      `SmartStudy`,
    html:
      `<p>Ciao ${safeName},</p>` +
      `<p>il tuo codice SmartStudy per reimpostare la password è:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>` +
      `<p>Il codice scade tra <strong>${expiresMinutes} minuti</strong>.</p>` +
      `<p>Se non hai richiesto il recupero password, ignora questa email.</p>` +
      `<p>SmartStudy</p>`,
  });
}

module.exports = {
  isConfigured,
  sendPasswordResetCode,
};

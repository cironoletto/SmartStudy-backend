//require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -------------------------
   1) RIASSUNTO UMANISTICO
--------------------------*/
exports.generateSummary = async (text) => {
  try {
    const prompt = `
Riassumi in modo chiaro, coerente e con stile scolastico:

${text}
`;
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });
    return response.choices[0].message.content.trim();
  } catch {
    return "Errore nella generazione del riassunto.";
  }
};

/* -------------------------
   1B) RIASSUNTO ORALE
--------------------------*/
exports.generateOralSummary = async (text) => {
  try {
    const prompt = `
Crea uno schema RIASSUNTIVO per esposizione orale.
Usa punti elenco, concetti chiave, tono semplice.

Testo:

${text}
`;
    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    return r.choices[0].message.content.trim();
  } catch {
    return "Errore nella generazione dello schema orale.";
  }
};

/* -------------------------
  2) SCIENTIFICO
--------------------------*/
exports.solveScientific = async (text) => {
  try {
    const prompt = `
Il seguente testo contiene un PROBLEMA scientifico.

ESTRAI:
1. La versione riscritta del problema
2. La spiegazione passo passo
3. La risposta finale

Torna in JSON:

{
  "steps": "...",
  "finalAnswer": "..."
}
Testo:
${text}
`;
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { steps: "", finalAnswer: "" };
  }
};

/* -------------------------
   3) TRASCRIZIONE WHISPER
--------------------------*/
exports.transcribeAudio = async (audioPath) => {
  try {
    const response = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",    // NUOVO MODELLO 2025
      file: fs.createReadStream(audioPath),
      response_format: "json"         // garantisce JSON corretto
    });

    return response.text || "";        // se assente restituiamo ""
  } catch (err) {
    console.error("❌ Whisper ERROR:", err);
    return "";
  }
};


/* -------------------------
   4) VALUTAZIONE ORALE (vecchia — NON usata)
--------------------------*/
exports.evaluateOral = async (reference, userText) => {
  try {
    console.log("📌 TESTO TRASCRITTO:", userText);

    const prompt = `
Valuta questo discorso orale basandoti su:

Testo ideale:
${reference}

Testo studente:
${userText}

Fornisci:
- Analisi
- Errori
- Qualità esposizione
- Voto /10
- Suggerimenti
`;

    const r = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    return r.choices[0].message.content.trim();
  } catch {
    return "Errore nella valutazione orale.";
  }
};

/* ===========================================================
   ⭐ 5) VALUTAZIONE ORALE — NUOVA VERSIONE JSON
=========================================================== */
/* -------------------------
   5) VALUTAZIONE ORALE CON PUNTEGGIO (0-100)
--------------------------*/
exports.scoreOralAnswer = async (reference, userText) => {
  try {
    const prompt = `
Sei un insegnante. Valuta la risposta orale di uno studente rispetto al testo ideale.

Testo ideale:
${reference || "(nessun testo ideale disponibile)"}

Risposta studente (trascritta):
${userText || "(vuota)"}

Restituisci un JSON con questa struttura:

{
  "feedback": "testo con analisi, errori, consigli, voto spiegato",
  "score": 0-100
}
`;

    const r = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const parsed = JSON.parse(r.choices[0].message.content || "{}");

    return {
      feedback: parsed.feedback || "",
      score:
        typeof parsed.score === "number"
          ? parsed.score
          : null,
    };
  } catch (err) {
    console.error("❌ scoreOralAnswer error:", err);
    return {
      feedback: "Errore nella valutazione orale.",
      score: null,
    };
  }
};

// require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* =========================================================
   🔒 FILTRO AUTOMATICO ANTI-ERRORI (CENTRALE)
========================================================= */
function containsInvalidAssumptions(text) {
  if (!text) return false;

  const forbidden = [
    "supponiamo",
    "scegliamo",
    "ad esempio",
    "per semplicità",
    "ipotizziamo",
    "assumiamo che",
    "poniamo che",
    "consideriamo per semplicità",
    "scegliendo un valore",
    "prendiamo",
  ];

  return forbidden.some(word =>
    text.toLowerCase().includes(word)
  );
}

function looksLikeCalculation(text) {
  return (
    text.toLowerCase().includes("passo") ||
    text.toLowerCase().includes("calcol") ||
    text.toLowerCase().includes("=") ||
    text.toLowerCase().includes("derivat") ||
    text.toLowerCase().includes("limite")
  );
}

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
   2) SCIENTIFICO (JSON BASE)
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
   3) TRASCRIZIONE AUDIO
--------------------------*/
exports.transcribeAudio = async (audioPath) => {
  try {
    const response = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: fs.createReadStream(audioPath),
      response_format: "json"
    });

    return response.text || "";
  } catch (err) {
    console.error("❌ Whisper ERROR:", err);
    return "";
  }
};

/* =========================================================
   📘 SPIEGAZIONE TEORICA (CON FILTRO)
========================================================= */
exports.explainScientificTheory = async (text) => {
  const prompt = `
Spiega l’esercizio SOLO dal punto di vista TEORICO.

⚠️ REGOLE OBBLIGATORIE:
- NON svolgere l’esercizio
- NON scrivere formule complete
- NON usare numeri specifici
- NON introdurre parametri o valori
- NON calcolare derivate o limiti

Devi spiegare:
- cosa chiede il problema
- quali concetti matematici sono coinvolti
- quale metodo generale si usa
- quali errori tipici evitare

Struttura obbligatoria:
TITOLO
Obiettivo dell’esercizio
Concetti matematici coinvolti
Metodo generale di risoluzione
Errori comuni da evitare
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Sei un professore di matematica molto rigoroso." },
      { role: "user", content: text },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  const content = res.choices[0].message.content.trim();

  // 🔒 FILTRO TEORIA
  if (
    containsInvalidAssumptions(content) ||
    looksLikeCalculation(content)
  ) {
    throw new Error("Spiegazione teorica NON valida");
  }

  return { text: content };
};

/* =========================================================
   ✏️ SVOLGIMENTO GUIDATO (CON FILTRO)
========================================================= */
exports.solveScientificGuided = async (text) => {
  const prompt = `
Svolgi l’esercizio in modo COMPLETO e GUIDATO.

⚠️ REGOLE OBBLIGATORIE:
- NON inventare dati mancanti
- NON fare ipotesi arbitrarie
- NON scegliere valori “per semplicità”
- Se un dato manca, dichiaralo esplicitamente
- Ogni passaggio deve essere giustificato

Struttura obbligatoria:
PASSO 1 – Comprensione del problema
PASSO 2 – Impostazione matematica
PASSO 3 – Applicazione delle condizioni
PASSO 4 – Risoluzione
PASSO 5 – Risultato finale
`;

  try {
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Sei un professore di matematica." },
        { role: "user", content: text },
        { role: "user", content: prompt },
      ],
    });

    const content = res.choices[0].message.content;

    // 🔒 FILTRO SVOLGIMENTO
    if (containsInvalidAssumptions(content)) {
      throw new Error("SCIENTIFIC_NOT_SOLVABLE");
    }

    return {
      steps: content.split("\n\n"),
      finalAnswer: content,
      fallback: false,
    };

  } catch (e) {
    // 🟡 FALLBACK CONTROLLATO → RIASSUNTO
    console.warn("⚠️ Scientific fallback to summary");

    const summary = await exports.generateSummary(text);

    return {
      steps: [
        "Il testo non consente una risoluzione scientifica rigorosa.",
        "Segue una spiegazione riassuntiva del contenuto:",
      ],
      finalAnswer: summary,
      fallback: true,
    };
  }
};


exports.scoreOralAnswer = async (referenceText, studentText) => {
  const prompt = `
Sei un INSEGNANTE DI SCUOLA.

Valuta l'esposizione orale di uno studente confrontandola con il testo di riferimento.

=== TESTO DI RIFERIMENTO ===
${referenceText}

=== ESPOSIZIONE DELLO STUDENTE ===
${studentText}

Valuta usando ESCLUSIVAMENTE questa RUBRICA (0–10 ciascuno):

1. Contenuto (correttezza e completezza)
2. Chiarezza espositiva
3. Lessico specifico della materia
4. Autonomia espressiva (parole proprie)

REGOLE:
- Sii severo ma equo
- Non inventare informazioni
- Non penalizzare piccoli errori grammaticali
- Usa uno stile da professore

Rispondi SOLO in JSON nel formato:

{
  "contenuto": 0,
  "chiarezza": 0,
  "lessico": 0,
  "autonomia": 0,
  "voto_finale": 0,
  "commento_prof": ""
}
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  return JSON.parse(res.choices[0].message.content);
};


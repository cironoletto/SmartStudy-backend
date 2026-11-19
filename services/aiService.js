// require("dotenv").config();
const OpenAI = require("openai");
const fs = require("fs");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-6-luna";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";

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
Devi trasformare il testo seguente in un RIASSUNTO DI STUDIO
completo, chiaro e realmente utile per prepararsi a una verifica
o a un'interrogazione.

IMPORTANTE:
Non creare un riassunto troppo breve o telegrafico.
L'obiettivo non è ridurre il testo al minimo, ma renderlo più
semplice da studiare mantenendo tutte le informazioni importanti.

REGOLE:

1. Mantieni TUTTI i concetti fondamentali presenti nel testo.

2. Non eliminare:
   - definizioni;
   - nomi importanti;
   - date;
   - eventi;
   - formule;
   - classificazioni;
   - cause e conseguenze;
   - caratteristiche;
   - esempi utili;
   - passaggi logici importanti.

3. Spiega i concetti con frasi complete e comprensibili.
   Non limitarti a un elenco di parole chiave.

4. Se il testo originale è lungo, anche il riassunto deve essere
   sufficientemente approfondito.
   La lunghezza deve essere proporzionata alla quantità e alla
   complessità del materiale originale.

5. Organizza il contenuto in sezioni con titoli chiari quando
   nel testo sono presenti più argomenti.

6. Usa paragrafi brevi e leggibili.

7. Quando due concetti sono collegati, spiega il collegamento
   invece di presentarli come informazioni isolate.

8. Se sono presenti sequenze, fasi, procedimenti o classificazioni,
   mantienili nell'ordine corretto.

9. Non aggiungere informazioni che non siano presenti nel testo.
   Non inventare date, esempi, spiegazioni o fatti.

10. Correggi soltanto evidenti errori di lettura OCR quando il
    significato corretto è inequivocabile. Se il significato non
    è chiaro, non inventarlo.

11. Evita introduzioni inutili come:
    "Ecco il riassunto del testo".

12. Alla fine aggiungi una sezione:

CONCETTI DA RICORDARE

con 5-10 punti essenziali, oppure un numero maggiore se il
materiale è particolarmente ricco.

STILE:
- scolastico;
- chiaro;
- discorsivo;
- approfondito ma non ripetitivo;
- adatto a uno studente che deve imparare l'argomento;
- linguaggio semplice senza impoverire i contenuti.

TESTO DA RIASSUMERE:

${text}
`;

    const response =
      await client.chat.completions.create({
        model: TEXT_MODEL,
        reasoning_effort: "none",
        messages: [
          {
            role: "system",
            content:
              "Sei un tutor scolastico esperto. Produci riassunti completi e didattici che semplificano il materiale senza perdere le informazioni importanti.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.25,
      });

    return response.choices[0].message.content.trim();

  } catch (err) {
    console.error(
      "SUMMARY GENERATION ERROR:",
      err
    );

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
      model: TEXT_MODEL,
      reasoning_effort: "none",
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
      model: TEXT_MODEL,
      reasoning_effort: "none",
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
      model: TRANSCRIBE_MODEL,
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
    model: TEXT_MODEL,
      reasoning_effort: "none",
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
  try {
    const prompt = `
Sei un tutor esperto di matematica, fisica e chimica.

Devi analizzare e risolvere l'esercizio fornito dallo studente
in modo completo, corretto e didattico.

REGOLE OBBLIGATORIE:

- Non inventare mai dati mancanti.
- Non fare ipotesi arbitrarie.
- Se un dato non e leggibile o manca, dichiaralo chiaramente.
- Individua prima che tipo di esercizio e.
- Mostra tutti i passaggi necessari.
- Non saltare i passaggi matematici importanti.
- Spiega brevemente il motivo di ogni passaggio.
- Mantieni formule, segni, parentesi, frazioni e potenze corretti.
- Controlla sempre il risultato finale quando possibile.
- Per equazioni e sistemi verifica la soluzione sostituendola.
- Per problemi geometrici indica formule e dati utilizzati.
- Per fisica e chimica mantieni sempre le unita di misura.
- Effettua le conversioni di unita esplicitamente.
- Non arrotondare durante i calcoli se non necessario.
- Se serve un'approssimazione, arrotonda solo alla fine.
- Se l'OCR sembra aver letto male un simbolo, correggilo solo
  quando il significato corretto e inequivocabile.

Puoi risolvere, tra gli altri:

- operazioni e frazioni;
- espressioni;
- potenze e radicali;
- proporzioni;
- equazioni;
- disequazioni;
- sistemi;
- problemi con percentuali;
- geometria;
- geometria analitica;
- funzioni;
- limiti;
- derivate;
- integrali;
- problemi di fisica;
- problemi di chimica.

Se l'esercizio NON puo essere risolto con i dati disponibili,
non inventare la soluzione.

Rispondi ESCLUSIVAMENTE con JSON nel formato:

{
  "solvable": true,
  "exerciseType": "tipo di esercizio",
  "givenData": [
    "dato 1",
    "dato 2"
  ],
  "steps": [
    "Passaggio 1...",
    "Passaggio 2...",
    "Passaggio 3..."
  ],
  "verification": "Controllo del risultato, se possibile",
  "finalAnswer": "Risultato finale",
  "missingData": []
}

Se mancano dati:

{
  "solvable": false,
  "exerciseType": "tipo di esercizio se riconoscibile",
  "givenData": [],
  "steps": [],
  "verification": "",
  "finalAnswer": "",
  "missingData": [
    "dato mancante o non leggibile"
  ]
}

ESERCIZIO:

${text}
`;

    const response =
      await client.chat.completions.create({
        model: TEXT_MODEL,
        reasoning_effort: "none",

        messages: [
          {
            role: "system",
            content:
              "Sei un insegnante esperto di matematica e materie scientifiche. Risolvi gli esercizi mostrando un procedimento rigoroso, chiaro e verificabile senza inventare dati.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],

        temperature: 0.15,

        response_format: {
          type: "json_object",
        },
      });

    const result =
      JSON.parse(
        response.choices[0]
          .message.content
      );

    if (
      result.solvable === false
    ) {
      const missing =
        Array.isArray(
          result.missingData
        )
          ? result.missingData
          : [];

      return {
        steps: [
          "L'esercizio non puo essere risolto con certezza con i dati disponibili.",
          ...missing.map(
            (item) =>
              `Dato mancante o non leggibile: ${item}`
          ),
        ],

        finalAnswer:
          "Controlla la foto dell'esercizio e assicurati che tutti i dati, i numeri e i simboli siano leggibili.",

        fallback: true,
      };
    }

    const steps =
      Array.isArray(result.steps)
        ? result.steps
            .map((step) =>
              String(step).trim()
            )
            .filter(Boolean)
        : [];

    if (
      result.verification &&
      String(
        result.verification
      ).trim()
    ) {
      steps.push(
        `Verifica: ${String(
          result.verification
        ).trim()}`
      );
    }

    const finalAnswer =
      String(
        result.finalAnswer || ""
      ).trim();

    if (!finalAnswer) {
      throw new Error(
        "SCIENTIFIC_FINAL_ANSWER_MISSING"
      );
    }

    return {
      steps,
      finalAnswer,
      fallback: false,
    };

  } catch (err) {
    console.error(
      "SCIENTIFIC SOLVER ERROR:",
      err
    );

    return {
      steps: [
        "Non e stato possibile completare la risoluzione dell'esercizio.",
      ],

      finalAnswer:
        "Riprova con una foto piu nitida e completa dell'esercizio.",

      fallback: true,
    };
  }
};

exports.explainScientificStep = async (
  exerciseText,
  step,
  stepNumber
) => {
  try {
    const prompt = `
Sei un tutor scolastico esperto di matematica,
fisica e chimica.

Uno studente sta svolgendo questo esercizio:

=== ESERCIZIO ===
${exerciseText}

Durante la soluzione e arrivato a questo passaggio:

=== PASSAGGIO ${stepNumber} ===
${step}

Devi spiegare SOLO questo passaggio in modo molto chiaro
e didattico.

REGOLE:

- Spiega cosa viene fatto nel passaggio.
- Spiega PERCHE viene fatto.
- Se viene applicata una formula o una regola,
  indica quale e spiegala brevemente.
- Se ci sono operazioni matematiche, mostrale chiaramente.
- Se vengono sostituiti dei valori, indica da dove provengono.
- Se ci sono unita di misura, mantienile.
- Non saltare passaggi intermedi utili.
- Usa un linguaggio semplice, adatto a uno studente.
- Non inventare dati non presenti nell'esercizio.
- Non cambiare il metodo di soluzione.
- Non risolvere nuovamente tutto l'esercizio.
- Concentrati esclusivamente sul passaggio richiesto.

Rispondi SOLO in JSON:

{
  "explanation": "Spiegazione dettagliata del passaggio",
  "why": "Perche questo passaggio e necessario",
  "rule": "Formula o regola utilizzata, se presente"
}
`;

    const response =
      await client.chat.completions.create({
        model: TEXT_MODEL,
        reasoning_effort: "none",

        messages: [
          {
            role: "system",
            content:
              "Sei un tutor paziente e rigoroso. Spiega un singolo passaggio matematico o scientifico senza inventare informazioni.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],

        temperature: 0.2,

        response_format: {
          type: "json_object",
        },
      });

    const result =
      JSON.parse(
        response.choices[0]
          .message.content
      );

    return {
      explanation:
        String(
          result.explanation || ""
        ).trim(),

      why:
        String(
          result.why || ""
        ).trim(),

      rule:
        String(
          result.rule || ""
        ).trim(),
    };

  } catch (err) {
    console.error(
      "SCIENTIFIC STEP EXPLANATION ERROR:",
      err
    );

    return null;
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
    model: TEXT_MODEL,
      reasoning_effort: "none",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  return JSON.parse(res.choices[0].message.content);
};


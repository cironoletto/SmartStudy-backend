// controllers/quizFromOCRController.js
console.log("🔥 USING quizFromOCRController.js VERSION PG");

const OpenAI = require("openai");
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Prompt allineato al DB + frontend: usa "type" + "choices"
const QUIZ_SYSTEM_PROMPT = `
Sei un generatore di quiz scolastici.

⚠️ REGOLE OBBLIGATORIE:
- Genera ALMENO 5 domande.
- Ogni domanda MCQ deve avere ESATTAMENTE 4 scelte in "choices".
- "correctIndex" deve essere 0..3.
- Non restituire mai "questions" vuoto.
- Se il testo OCR è poco chiaro, inventa domande GENERICHE ma coerenti con l'argomento.

RISPONDI SOLO CON JSON:

{
  "title": "Titolo del quiz",
  "description": "Breve descrizione",
  "questions": [
    {
      "type": "mcq",
      "text": "Domanda",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "points": 1
    },
    {
      "type": "open",
      "text": "Domanda aperta",
      "idealAnswer": "Risposta ideale",
      "points": 1
    }
  ]
}
`;

function normalizeQuizJson(quizJson) {
  const title = quizJson?.title || "Quiz generato";
  const description = quizJson?.description || "";

  let questions = Array.isArray(quizJson?.questions) ? quizJson.questions : [];

  // ✅ Compatibilità: se il modello risponde con "options" al posto di "choices"
  questions = questions.map((q) => {
    const type = q?.type || "mcq";

    // MCQ
    if (type === "mcq") {
      const choices = Array.isArray(q?.choices)
        ? q.choices
        : Array.isArray(q?.options)
          ? q.options
          : null;

      return {
        type: "mcq",
        text: String(q?.text || "").trim(),
        choices: Array.isArray(choices) ? choices.slice(0, 4) : [],
        correctIndex: Number.isInteger(q?.correctIndex) ? q.correctIndex : 0,
        points: Number.isFinite(q?.points) ? q.points : 1,
      };
    }

    // OPEN
    return {
      type: "open",
      text: String(q?.text || "").trim(),
      idealAnswer: String(q?.idealAnswer || "").trim(),
      points: Number.isFinite(q?.points) ? q.points : 1,
    };
  });

  // ✅ Filtra domande vuote
  questions = questions.filter((q) => q.text && q.text.length >= 3);

  // ✅ Assicura almeno 5 domande (fallback)
  if (questions.length < 5) {
    const filler = [];
    while (questions.length + filler.length < 5) {
      filler.push({
        type: "mcq",
        text: `Domanda di ripasso #${questions.length + filler.length + 1}`,
        choices: ["Opzione A", "Opzione B", "Opzione C", "Opzione D"],
        correctIndex: 0,
        points: 1,
      });
    }
    questions = [...questions, ...filler];
  }

  // ✅ Fix correctIndex range
  questions = questions.map((q) => {
    if (q.type !== "mcq") return q;
    let idx = Number.isInteger(q.correctIndex) ? q.correctIndex : 0;
    if (idx < 0) idx = 0;
    if (idx > 3) idx = 3;
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const padded = [...choices];
    while (padded.length < 4) padded.push(`Opzione ${padded.length + 1}`);
    return { ...q, choices: padded.slice(0, 4), correctIndex: idx };
  });

  return { title, description, questions };
}

// POST /api/quiz/from-images
exports.generateQuizFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Nessuna immagine ricevuta" });
    }

    console.log("📸 OCR >>", req.files.length, "immagini");

    let rawText = "";
    try {
      rawText = await extractTextFromImages(req.files);
    } catch {
      rawText = "";
    }

    if (!rawText || rawText.trim().length < 10) {
      rawText = "Testo non chiaro. Genera un quiz scolastico generico ma coerente.";
    }

    const truncatedText = rawText.slice(0, 6000);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: `Testo OCR:\n${truncatedText}` },
      ],
      temperature: 0.3,
    });

    const quizJson = JSON.parse(completion.choices[0].message.content);
    const normalized = normalizeQuizJson(quizJson);

    const quizData = {
      userID,
      title: normalized.title,
      description: normalized.description,
      questions: normalized.questions,
    };

    const quizID = await quizModel.createQuizWithQuestions(quizData);

    return res.json({
      quizID,
      title: quizData.title,
      description: quizData.description,
      questions: quizData.questions,
    });
  } catch (err) {
    console.error("❌ OCR QUIZ ERROR:", err);
    res.status(500).json({ error: "Errore durante la generazione del quiz" });
  }
};

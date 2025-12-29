const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");
const OpenAI = require("openai");
const { checkAndIncrement } = require("../services/usageLimitService");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.createQuizFromImage = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) {
      return res.status(401).json({ error: "Utente non autenticato" });
    }

    /* ===============================
       📸 GESTIONE IMMAGINI
    =============================== */

    // compatibile sia con upload singolo che multiplo
    const files = req.files || (req.file ? [req.file] : []);

    if (!files.length) {
      return res.status(400).json({ error: "Nessuna immagine caricata" });
    }

    // 🔒 LIMITE IMMAGINI QUIZ: 5
    if (files.length > 5) {
      return res.status(400).json({
        error: "IMAGE_LIMIT_EXCEEDED",
        limit: 5
      });
    }

    /* ===============================
       🧠 LIMITE QUIZ GIORNALIERI
    =============================== */

    // 🔒 FREE: 2 quiz al giorno
    const quizLimit = await checkAndIncrement(
      userID,
      "quiz_sessions",
      2
    );

    if (!quizLimit.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "quiz_sessions",
        limit: 2,
        reset: "domani"
      });
    }

    /* ===============================
       🔎 OCR
    =============================== */

    const rawText = await extractTextFromImages(files);

    /* ===============================
       🧠 PROMPT QUIZ
    =============================== */

    const prompt = `
Genera un quiz in formato JSON con ALMENO 5 domande.

Struttura obbligatoria:

{
  "title": "...",
  "description": "...",
  "questions": [
    {
      "type": "mcq",
      "text": "...",
      "choices": ["A","B","C","D"],
      "correctIndex": 0,
      "points": 1
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Sei un generatore di quiz scolastici." },
        { role: "system", content: prompt },
        { role: "user", content: `Testo OCR:\n${rawText}` }
      ],
      temperature: 0.3
    });

    const quizJson = JSON.parse(
      completion.choices[0].message.content
    );

    /* ===============================
       ✅ VALIDAZIONE QUIZ
    =============================== */

    if (
      !Array.isArray(quizJson.questions) ||
      quizJson.questions.length < 5
    ) {
      return res.status(400).json({
        error: "Non sono riuscito a generare domande valide da queste immagini."
      });
    }

    const validQuestions = quizJson.questions.filter(q =>
      q.text &&
      Array.isArray(q.choices) &&
      q.choices.length === 4 &&
      typeof q.correctIndex === "number"
    );

    if (validQuestions.length < 5) {
      return res.status(400).json({
        error: "Le domande generate non sono strutturate correttamente."
      });
    }

    /* ===============================
       💾 SALVATAGGIO QUIZ
    =============================== */

    const quizID = await quizModel.createQuizWithQuestions({
      userID,
      title: quizJson.title || "Quiz generato",
      description: quizJson.description || "",
      questions: validQuestions
    });

    res.json({ quizID });

  } catch (err) {
    console.error("createQuizFromImage ERROR:", err);
    res.status(500).json({ error: "Errore generazione quiz" });
  }
};

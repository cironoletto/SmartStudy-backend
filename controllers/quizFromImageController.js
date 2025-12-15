// controllers/legacyCreateQuizFromImage.js
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.createQuizFromImage = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) {
      return res.status(401).json({ error: "Utente non autenticato" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nessuna immagine caricata" });
    }

    const rawText = await extractTextFromImages([req.file]);

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

    const quizJson = JSON.parse(completion.choices[0].message.content);

    if (!Array.isArray(quizJson.questions) || quizJson.questions.length < 5) {
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

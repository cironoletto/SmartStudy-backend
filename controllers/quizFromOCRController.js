// controllers/quizFromOCRController.js
console.log("🔥 USING quizFromOCRController.js VERSION PG");

const OpenAI = require("openai");
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const QUIZ_SYSTEM_PROMPT = `
Sei un generatore di quiz estremamente conciso.
Restituisci SOLO un JSON con la struttura richiesta.
`;

// POST /api/quiz/from-images
exports.generateQuizFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "Nessuna immagine ricevuta" });

    console.log("📸 OCR >>", req.files.length, "immagini");

    let rawText = "";
    try {
      rawText = await extractTextFromImages(req.files);
    } catch {
      rawText = "";
    }

    if (!rawText || rawText.trim().length < 10) {
      rawText = "Testo non chiaro. Genera un breve quiz.";
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

    const quizData = {
      userID,
      title: quizJson.title || "Quiz generato",
      description: quizJson.description || "",
      questions: quizJson.questions || [],
    };

    const quizID = await quizModel.createQuizWithQuestions(quizData);

    res.json({
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

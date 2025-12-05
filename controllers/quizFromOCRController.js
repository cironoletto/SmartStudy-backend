// controllers/quizFromOCRController.js
console.log("🔥 USING quizFromOCRController.js VERSION X");
const OpenAI = require("openai");
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Prompt compatto
const QUIZ_SYSTEM_PROMPT = `
Sei un generatore di quiz estremamente conciso.
Ti verrà dato del testo (appunti, libro, slide).
Devi restituire SOLO un JSON con questa struttura:

{
  "title": "titolo breve del quiz",
  "description": "descrizione breve",
  "questions": [
    {
      "type": "mcq" | "open",
      "text": "testo della domanda",
      "choices": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "idealAnswer": "risposta ideale",
      "points": 1
    }
  ]
}

- Genera 8-10 domande massimo.
- NON aggiungere testo fuori dal JSON.
`;


// POST /api/quiz/from-images
exports.generateQuizFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) {
      return res.status(401).json({ error: "Utente non autenticato" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Nessuna immagine ricevuta" });
    }

    console.log("📸 OCR >> ricevute", req.files.length, "immagini");

    // 1) OCR con protezioni
    console.log("➡️ OCR START...");
    let rawText = "";
    try {
      rawText = await extractTextFromImages(req.files);
    } catch (err) {
      console.error("❌ OCR FAILED:", err);
    }

    console.log("➡️ OCR DONE:", rawText.length, "caratteri");

    // fallback: se OCR vuoto → testo base
    if (!rawText || rawText.trim().length < 10) {
      console.log("⚠️ OCR vuoto → uso fallback");
      rawText = "Testo poco leggibile. Genera un breve quiz generale.";
    }

    // troncamento per risparmiare token
    const truncatedText = rawText.slice(0, 6000);

    // 2) chiamata OpenAI
    console.log("➡️ OpenAI: sending request...");

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: QUIZ_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Testo OCR:\n\n${truncatedText}`,
              },
            ],
          },
        ],
        max_tokens: 1200,
        temperature: 0.3,
      });
    } catch (err) {
      console.error("❌ OpenAI API ERROR:", err);
      return res
        .status(500)
        .json({ error: "Errore OpenAI", detail: err.message });
    }

    console.log("➡️ OpenAI: response received!");

    const content = completion.choices[0].message.content;

    // 3) parsing JSON
    let quizJson;
    try {
      quizJson = JSON.parse(content);
    } catch (e) {
      console.error("❌ Errore parse JSON OpenAI:", e);
      console.log("⚠️ Contenuto OpenAI:", content);
      return res.status(500).json({ error: "AI: JSON non valido" });
    }

    if (!Array.isArray(quizJson.questions)) {
      return res.status(500).json({ error: "AI: campo questions non valido" });
    }

    // 4) normalizzazione
    const quizData = {
      userID,
      title: quizJson.title || "Quiz generato da OCR",
      description: quizJson.description || "Quiz generato dagli appunti",
      questions: quizJson.questions.map((q) => ({
        type: q.type === "open" ? "open" : "mcq",
        text: q.text || "",
        choices:
          q.type === "mcq" && Array.isArray(q.choices) ? q.choices : undefined,
        correctIndex:
          q.type === "mcq" && typeof q.correctIndex === "number"
            ? q.correctIndex
            : undefined,
        idealAnswer:
          q.type === "open" && typeof q.idealAnswer === "string"
            ? q.idealAnswer
            : undefined,
        points: q.points || 1,
      })),
    };

    // 5) salvataggio quiz + domande
    const quizID = await quizModel.createQuizWithQuestions(quizData);

    return res.json({
      quizID,
      title: quizData.title,
      description: quizData.description,
      questions: quizData.questions,
    });

  } catch (err) {
    console.error("❌ OCR ERROR:", err);
    res.status(500).json({ error: "Errore durante la generazione del quiz" });
  }
};

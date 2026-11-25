console.log("USING quizFromOCRController.js VERSION PG");
const outputLanguage = require("../services/outputLanguage");
const fs = require("fs");
const OpenAI = require("openai");
const { extractTextFromImages } = require("./localOCR");
const quizModel = require("../models/quizModel");
const {
  checkLimit,
} = require("../services/usageLimitService");
const { getSubscriptionStatus } = require("../services/subscriptionService");
const { getUsagePolicy } = require("../services/usagePolicy");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-6-luna";

const QUIZ_SYSTEM_PROMPT = `
Sei un generatore di quiz scolastici.

REGOLE OBBLIGATORIE:
- Genera ALMENO 5 domande. Includi almeno una domanda aperta con risposta ideale.
- Ogni domanda MCQ deve avere ESATTAMENTE 4 scelte in "choices".
- "correctIndex" deve essere 0..3.
- Non restituire mai "questions" vuoto.
- Se il testo OCR e poco chiaro, genera domande generiche ma coerenti con l'argomento rilevabile.

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
}`;

function normalizeQuizJson(quizJson, english) {
  const title = quizJson?.title || (english ? "Generated quiz" : "Quiz generato");
  const description = quizJson?.description || "";
  const questions = [];
  for (const q of Array.isArray(quizJson?.questions) ? quizJson.questions : []) {
    const text = typeof q?.text === "string" ? q.text.trim() : "";
    if (text.length < 3) continue;
    const points = Number.isSafeInteger(q.points) && q.points > 0 ? q.points : 1;
    if (q.type === "open") {
      const idealAnswer = typeof q.idealAnswer === "string" ? q.idealAnswer.trim() : "";
      if (idealAnswer) questions.push({ type: "open", text, idealAnswer, points });
    } else if (q.type === "mcq") {
      const choices = q.choices ?? q.options;
      if (Array.isArray(choices) && choices.length === 4 &&
          choices.every(choice => typeof choice === "string" && choice.trim()) &&
          Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < choices.length) {
        questions.push({ type: "mcq", text, choices, correctIndex: q.correctIndex, points });
      }
    }
  }
  if (questions.length < 5) throw new Error("QUIZ_TOO_FEW_VALID_QUESTIONS");
  if (!questions.some(q => q.type === "open")) throw new Error("QUIZ_MISSING_OPEN_QUESTION");
  return { title, description, questions };
}

exports.generateQuizFromImages = async (req, res) => {
  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "Utente non autenticato" });

  const files = req.files || [];

const requestID = String(
  req.body?.requestID || ""
)
  .trim()
  .slice(0, 100);

const subscription =
  await getSubscriptionStatus(
    userID
  );

const policy =
  getUsagePolicy(
    subscription.isPro
  );

/* ---------------------------------------------------------
   RETRY IDEMPOTENTE
   Se il quiz esiste già, non rifare OCR/OpenAI
--------------------------------------------------------- */
if (requestID) {
  const existingQuiz =
    await quizModel.getQuizByRequestID(
      userID,
      requestID
    );

  if (existingQuiz) {


    const currentLimit =
      await checkLimit(
        userID,
        "quiz_sessions",
        policy.quizDaily
      );

    return res.json({
      quizID:
        existingQuiz.quizID,

      title:
        existingQuiz.title,

      description:
        existingQuiz.description,

      questions:
        existingQuiz.questions,

      isPro:
        subscription.isPro,

      limit:
        policy.quizDaily,

      remaining:
        Math.max(
          0,
          Number(
            currentLimit.remaining ||
              0
          )
        ),

      reused: true,
    });
  }
}

if (!files.length) {
  return res.status(400).json({
    error:
      "Nessuna immagine ricevuta",
  });
}

    if (files.length > policy.quizMaxImages) {
      return res.status(400).json({
        error: "IMAGE_LIMIT_EXCEEDED",
        limit: policy.quizMaxImages,
      });
    }

    const limitCheck = await checkLimit(userID, "quiz_sessions", policy.quizDaily);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "quiz_sessions",
        limit: policy.quizDaily,
        remaining: 0,
        isPro: subscription.isPro,
        reset: "domani",
      });
    }

    let rawText = "";

    for (const file of files) {
      try {
        const text = await extractTextFromImages([file]);
        rawText += "\n" + (text || "");
      } catch (e) {
        console.warn("OCR failed:", file.filename || file.originalname);
      }
    }

    if (!rawText || rawText.trim().length < 10) {
      return res.status(400).json({
        error: "OCR_TEXT_TOO_SHORT",
        message: "Il testo nelle immagini non e abbastanza leggibile.",
      });
    }

    const truncatedText = rawText.slice(0, 10000);

    const completion = await openai.chat.completions.create({
      model: TEXT_MODEL,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT + "\n" + outputLanguage(req) },
        { role: "user", content: `Testo OCR:\n${truncatedText}` },
      ],
      temperature: 0.3,
    });

    const quizJson = JSON.parse(completion.choices[0].message.content);
    const normalized = normalizeQuizJson(quizJson, /^en\b/i.test(req.headers["accept-language"] || ""));

    const quizID =
  await quizModel.createQuizWithQuestions({
    userID,
    title: normalized.title,
    description:
      normalized.description,
    questions:
      normalized.questions,
    requestID:
      requestID || null,
  });

  const savedQuiz =
  requestID
    ? await quizModel.getQuizByRequestID(
        userID,
        requestID
      )
    : null;

return res.json({
  quizID,

  title:
    savedQuiz?.title ??
    normalized.title,

  description:
    savedQuiz?.description ??
    normalized.description,

  questions:
    savedQuiz?.questions ??
    normalized.questions,

  isPro:
    subscription.isPro,

  limit:
    policy.quizDaily,

  remaining:
    Math.max(
      0,
      Number(
        limitCheck.remaining || 0
      ) - 1
    ),
});
  } catch (err) {
    console.error("OCR QUIZ ERROR:", err);
    return res.status(500).json({ error: "Errore durante la generazione del quiz" });
  } finally {
    for (const file of req.files || []) {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }
};

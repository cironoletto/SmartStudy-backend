const fs = require("fs");
const OpenAI = require("openai");
const { checkLimit, incrementUsage } = require("../services/usageLimitService");
const { getSubscriptionStatus } = require("../services/subscriptionService");
const { getUsagePolicy } = require("../services/usagePolicy");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";

exports.stt = async (req, res) => {
  let fixedPath = null;

  try {
    const userID = req.user?.userId;
    if (!userID) return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!req.file) return res.status(400).json({ error: "Audio mancante" });

    const subscription = await getSubscriptionStatus(userID);
    const policy = getUsagePolicy(subscription.isPro);
    const limitCheck = await checkLimit(userID, "quiz_stt", policy.quizSttDaily);

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: "LIMIT_EXCEEDED",
        feature: "quiz_stt",
        limit: policy.quizSttDaily,
        remaining: 0,
        isPro: subscription.isPro,
        reset: "domani",
      });
    }

    const originalPath = req.file.path;
    fixedPath = `${originalPath}.m4a`;
    fs.renameSync(originalPath, fixedPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(fixedPath),
      model: TRANSCRIBE_MODEL,
      response_format: "json",
    });

    await incrementUsage(userID, "quiz_stt");

    return res.json({
      text: transcription.text || "",
      isPro: subscription.isPro,
      limit: policy.quizSttDaily,
      remaining: Math.max(0, Number(limitCheck.remaining || 0) - 1),
    });
  } catch (err) {
    console.error("STT BACKEND ERROR:", err);
    return res.status(500).json({ error: "Errore trascrizione audio" });
  } finally {
    if (fixedPath) {
      try { fs.unlinkSync(fixedPath); } catch {}
    } else {
      try { fs.unlinkSync(req.file?.path); } catch {}
    }
  }
};

// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token mancante" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 NORMALIZZAZIONE CHIAVI
    req.user = {
      UserID: decoded.userId,       // chiave che usa il backend
      userId: decoded.userId        // compatibilità
    };

    console.log("🔐 AUTH OK req.user =", req.user);

    next();
  } catch (err) {
    return res.status(401).json({ error: "Token non valido" });
  }
};


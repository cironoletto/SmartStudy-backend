const jwt =
  require("jsonwebtoken");

const JWT_SECRET =
  process.env.JWT_SECRET;

module.exports = function authMiddleware(
  req,
  res,
  next
) {
  if (!JWT_SECRET) {
    console.error(
      "JWT_SECRET non configurato"
    );

    return res
      .status(500)
      .json({
        error:
          "AUTH_CONFIGURATION_ERROR",

        message:
          "Configurazione autenticazione non disponibile.",
      });
  }

  const authorization =
    String(
      req.headers
        ?.authorization || ""
    ).trim();

  const parts =
    authorization.split(/\s+/);

  if (
    parts.length !== 2 ||
    parts[0].toLowerCase() !==
      "bearer" ||
    !parts[1]
  ) {
    return res
      .status(401)
      .json({
        error:
          "TOKEN_MISSING",

        message:
          "Sessione non disponibile. Accedi nuovamente.",
      });
  }

  const token =
    parts[1];

  try {
    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const userId =
      Number(
        decoded?.userId ??
          decoded?.UserID ??
          decoded?.userid
      );

    if (
      !Number.isInteger(
        userId
      ) ||
      userId <= 0
    ) {
      return res
        .status(401)
        .json({
          error:
            "TOKEN_INVALID",

          message:
            "Sessione non valida. Accedi nuovamente.",
        });
    }

    req.user = {
      ...decoded,
      userId,
      UserID: userId,
    };

    return next();

  } catch (err) {
    if (
      err?.name ===
      "TokenExpiredError"
    ) {
      return res
        .status(401)
        .json({
          error:
            "TOKEN_EXPIRED",

          message:
            "La sessione è scaduta. Accedi nuovamente.",
        });
    }

    console.warn(
      "JWT VERIFY ERROR:",
      err?.name,
      err?.message
    );

    return res
      .status(401)
      .json({
        error:
          "TOKEN_INVALID",

        message:
          "La sessione non è valida. Accedi nuovamente.",
      });
  }
};
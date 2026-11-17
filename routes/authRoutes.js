const express = require("express");
const router = express.Router();

const {
  register,
  login,
  me,
  setEmail,
  forgotPassword,
  resetPassword,
  deleteAccount,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", authMiddleware, me);
router.put("/email", authMiddleware, setEmail);
router.delete("/account", authMiddleware, deleteAccount);

module.exports = router;

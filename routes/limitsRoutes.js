const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const limitsController = require("../controllers/limitsController");

router.use(authMiddleware);
router.get("/status", limitsController.getLimitsStatus);

module.exports = router;

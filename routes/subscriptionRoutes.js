const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

router.use(authMiddleware);
router.get("/status", subscriptionController.getStatus);

module.exports = router;

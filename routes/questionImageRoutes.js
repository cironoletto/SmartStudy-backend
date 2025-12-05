// routes/questionImageRoutes.js

const express = require('express');
const router = express.Router();

const upload = require('../middleware/upload');
const { addQuestionWithImage } = require('../controllers/questionImageController');

router.post('/add', upload.single('image'), addQuestionWithImage);

module.exports = router;

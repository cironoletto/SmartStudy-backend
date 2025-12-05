const Tesseract = require("tesseract.js");

async function extractTextFromImage(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Nessuna immagine caricata" });
        }

        const imagePath = req.file.path;

        console.log("Esecuzione OCR su:", imagePath);

        const result = await Tesseract.recognize(imagePath, "ita", {
            logger: (m) => console.log(m), // log OCR
        });

        const text = result.data.text;

        res.json({
            message: "OCR completato",
            extractedText: text,
            image: imagePath,
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = { extractTextFromImage };

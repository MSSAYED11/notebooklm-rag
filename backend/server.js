import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";

// Fix for pdf-parse in ES Modules
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const pdfParse = typeof pdf === "function" ? pdf : pdf.default;

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION_NAME = "NotebookLM_Docs";

async function ensureCollectionExists() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
    if (!exists) {
      console.log(`Creating Qdrant collection: ${COLLECTION_NAME}`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: { size: 768, distance: "Cosine" }, 
      });
    }
  } catch (err) {
    console.error("Error checking/creating collection:", err);
  }
}

function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + chunkSize));
    index += chunkSize - overlap;
  }
  return chunks;
}

// 1. UPLOAD & INDEXING
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    await ensureCollectionExists();

    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(dataBuffer);
    const rawText = pdfData.text;

    const chunks = chunkText(rawText);
    console.log(`Processing ${chunks.length} chunks...`);

    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
    
    const points = [];
    for (const chunk of chunks) {
      const result = await embeddingModel.embedContent(chunk);
      points.push({
        id: uuidv4(),
        vector: result.embedding.values,
        payload: { text: chunk },
      });
    }

    await qdrant.upsert(COLLECTION_NAME, { wait: true, points });
    fs.unlinkSync(req.file.path);

    res.json({ message: "Document successfully ingested!" });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "Failed to process document" });
  }
});

// 2. RETRIEVAL & GENERATION
app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
    const queryEmbeddingResult = await embeddingModel.embedContent(question);
    
    const searchResults = await qdrant.search(COLLECTION_NAME, {
      vector: queryEmbeddingResult.embedding.values,
      limit: 4,
    });

    const contextText = searchResults.map((r) => r.payload.text).join("\n\n");
    const llmModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `You are a highly accurate AI assistant.
    Rule 1: Answer ONLY based on the provided Context.
    Rule 2: If the answer is not in the Context, say: "I cannot answer this based on the provided document."
    
    Context:
    ${contextText}
    
    User Question: ${question}`;

    const result = await llmModel.generateContent(prompt);
    res.json({ answer: result.response.text() });
  } catch (error) {
    console.error("Ask Error:", error);
    res.status(500).json({ error: "Failed to generate answer" });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
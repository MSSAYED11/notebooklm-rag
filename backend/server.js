import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// Use a new collection name since the embedding model size changed (Gemini uses 768)
const COLLECTION_NAME = "NotebookLM_Gemini_Docs";

// Initialize Gemini Embeddings model
const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-001", // Or "gemini-embedding-2"
    apiKey: process.env.GEMINI_API_KEY,
});

// Qdrant configuration
const qdrantConfig = {
    url: process.env.QDRANT_URL || "http://localhost:6333",
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION_NAME
};

// 1. UPLOAD & INDEXING
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        console.log(`Loading PDF from ${req.file.path}...`);
        const loader = new PDFLoader(req.file.path);
        const rawDocs = await loader.load();

        // Implement chunking strategy explicitly using RecursiveCharacterTextSplitter
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });

        const docs = await textSplitter.splitDocuments(rawDocs);
        console.log(`Processing ${docs.length} chunks...`);

        // Index into Qdrant Vector Store
        await QdrantVectorStore.fromDocuments(docs, embeddings, qdrantConfig);
        
        // Clean up the uploaded file
        fs.unlinkSync(req.file.path);

        console.log("Indexing Completed");
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

        // Retrieve from Vector Store
        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, qdrantConfig);
        
        const retriever = vectorStore.asRetriever({
            k: 3
        });

        const searchedChunks = await retriever.invoke(question);

        // Generation with Gemini
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-1.5-flash",
            apiKey: process.env.GEMINI_API_KEY,
        });

        const system_prompt = `You are an AI Assistant who helps resolving the user query based on the avaliable context provided to you from PDF file with the content and page number.

        Rule :
        - Only answer based on the avaliable context from the file only.
        - If the answer is not in the context, say: "I cannot answer this based on the provided document."

        context : ${JSON.stringify(searchedChunks)}`;

        const response = await llm.invoke([
            ["system", system_prompt],
            ["human", question]
        ]);

        const answer = response.content;
        console.log("Generated Answer:", answer);
        
        res.json({ answer: answer });
    } catch (error) {
        console.error("Ask Error:", error);
        res.status(500).json({ error: "Failed to generate answer" });
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
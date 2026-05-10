import { useState } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Update this URL after you deploy the backend to Render
  const API_BASE_URL = "https://notebooklm-rag-3pn3.onrender.com";

  // --- Handle Ingestion ---
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    setUploadStatus("Processing source...");
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        setUploadStatus("✅ Source added");
      } else {
        setUploadStatus("❌ Upload failed");
      }
    } catch (error) {
      setUploadStatus("❌ Connection error");
    } finally {
      setIsUploading(false);
    }
  };

  // --- Handle Retrieval & Generation ---
  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    const newChat = [...chatHistory, { role: 'user', content: question }];
    setChatHistory(newChat);
    setQuestion('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: newChat[newChat.length - 1].content }),
      });
      const data = await response.json();

      // Grounding check: ensure answer is from document 
      setChatHistory([...newChat, { role: 'ai', content: data.answer }]);
    } catch (error) {
      setChatHistory([...newChat, { role: 'ai', content: "Error: Could not reach the server." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar: Sources Control */}
      <aside className="sidebar">
        <h2 className="sidebar-title">Sources</h2>

        <div className="upload-controls">
          <form onSubmit={handleFileUpload}>
            <label className="pill-input">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setFile(e.target.files[0]);
                  setUploadStatus('');
                }}
              />
              <span>{file ? file.name : "+ Add source"}</span>
            </label>
            <button type="submit" className="action-pill" disabled={!file || isLoading || isUploading}>
              {isUploading ? "Processing..." : "Process PDF"}
            </button>
          </form>
          {uploadStatus && <p className="status-indicator">{uploadStatus}</p>}
        </div>

        <div className="sources-display">
          {file && uploadStatus.includes('✅') ? (
            <div className="source-chip">
              <span className="source-icon">📄</span>
              <span className="source-name">{file.name}</span>
            </div>
          ) : (
            <div className="empty-sources">
              <p>Saved sources will appear here</p>
              <small>Click Add source above to add PDFs.</small>
            </div>
          )}
        </div>
      </aside>

      {/* Main: Chat Canvas */}
      <main className="chat-canvas">

        <header className="top-header">
          <div className="header-left">
            <h2>NotebookLM</h2>
            <span className="header-badge">RAG Assistant</span>
          </div>

          <div className="header-right">
            <span className="header-status">
              {file ? "📄 Source Loaded" : "No Source"}
            </span>
          </div>
        </header>
        <div className="scroll-area">
          {chatHistory.length === 0 ? (
            <div className="hero-content">
              <span className="wave-icon">👋</span>
              <h1>Let's start your notebook...</h1>
              <p>This is your blank canvas to understand, create, or make progress on something new. Add your PDF source on the left to get started.</p>
            </div>
          ) : (
            <div className="message-container">
              {chatHistory.map((msg, index) => (
                <div key={index} className={`chat-row ${msg.role}`}>
                  <div className="bubble">
                    <p>{msg.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="chat-row ai">
                  <div className="bubble">
                    <p className="loading">Gemini is thinking...</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Chat Bar */}
        <div className="input-dock">
          <form onSubmit={handleAskQuestion} className="bar-wrapper">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Start typing..."
              disabled={isLoading}
            />
            <button type="submit" className="circle-send" disabled={isLoading || !question.trim()}>
              ➔
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default App;
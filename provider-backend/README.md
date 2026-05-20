# Continue.dev Human Operator AI Provider Backend

A complete OpenAI-compatible AI provider server and real-time dashboard for **Continue.dev** (VS Code / JetBrains). 

Instead of routing code completions to automated LLMs, this server queues requests and sends them to a live human operator dashboard, so you can manually review, reply, and stream custom developer completions directly back to the IDE.

---

## 📂 File Structure

```text
provider-backend/
 ├── server.js              # Express, Socket.IO, SSE Streaming Server
 ├── requests.js            # In-Memory Queue, SSE Connections, Expiry
 ├── package.json           # Dual sub-project dependencies
 ├── config-example.yaml    # Easy Continue.dev config instructions
 └── dashboard/             # Real-time Web Operator Dashboard
      ├── index.html        # Elegant Retro Dark Glassmorphism Console UI
      ├── app.js            # Real-time WebSocket clients
      └── styles.css        # Markdown rendering styles
```

---

## 🚀 Rapid Quickstart

### 1. Installation
In the `provider-backend` directory, run:
```bash
npm install
```

### 2. Startup
To start the live server on default Port `3000`:
```bash
npm start
```

### 3. Open the Operator Dashboard
Navigate to your web browser:
```text
http://localhost:3000/dashboard/
```
*(If you are previewing inside the Google AI Studio container, the dashboard renders immediately on your main preview url `GET /`)*

---

## 🔧 Connecting Continue.dev (VS Code or JetBrains)

1. Open VS Code/JetBrains and access your `config.json` folder.
   - On MacOS: `~/.continue/config.json` or click the gear icon in the Continue tab.
   - On Windows: `%USERPROFILE%\.continue\config.json`
2. Add the custom `HumanAI` model under the `models` array:

```json
{
  "models": [
    {
      "title": "Human Operator AI",
      "provider": "openai",
      "model": "human-model",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "dummy-token-not-required"
    }
  ]
}
```

3. Select **Human Operator AI** from the model dropdown in the Continue.dev side panel interface and type a prompt!

---

## 🧪 Direct Terminal Testing (No IDE required)

You can trigger a real-time event directly via terminal `curl` requests to ensure stream mechanics are flawless before launching your IDE:

### Test Case: Streaming Request (SSE)
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "human-model",
    "messages": [
      {
        "role": "user",
        "content": "Verify if the server can route this custom streaming curl block correctly."
      }
    ],
    "stream": true
  }'
```

### Test Case: Static REST Request (Non-streamed)
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "human-model",
    "messages": [
      {
        "role": "user",
        "content": "Perform static block request check."
      }
    ],
    "stream": false
  }'
```

---

## ✨ Outstanding Features Included

- ⚡ **Authentic OpenAI compatibility**: Supports both JSON Rest and `text/event-stream` formats.
- 🕒 **In-Memory Thread Store**: Holds live connections in Map caches with automatic inactivity timeouts (10 minutes) and automatic historical capacity pruning (holds 100 historical records safely).
- 🔊 **Visual & Acoustic Alerts**: Interactive synthetic chimes play in real-time when new coding tasks land in the queue.
- 📝 **Live Word / Character metrics**: Real-time counter feedback as you compose.
- 🎨 **Markdown Rendering Sandbox**: Renders and visualizes your code outputs natively with custom highlighting on the inspector deck before dispatching.

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestsStore } from './requests.js';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Enable JSON parser and CORS for Continue.dev and local extensions
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));
app.use(express.json());

// Serve Static files for the Dashboard
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Redirect Root to Dashboard for easy interactive usage inside AI Studio IFrame
app.get('/', (req, res) => {
  res.redirect('/dashboard/');
});

// Configure standard native Node HTTP + Socket.IO Server
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

/**
 * Socket.IO Connection Setup for Operator Dashboard
 */
io.on('connection', (socket) => {
  console.log(`[Dashboard Socket] Client connected: ${socket.id}`);

  // Send current state on connection
  socket.emit('init', {
    pending: requestsStore.getPendingRequests(),
    history: requestsStore.getHistory(),
  });

  socket.on('disconnect', () => {
    console.log(`[Dashboard Socket] Client disconnected: ${socket.id}`);
  });
});

/**
 * Endpoint 1: OpenAI-Compatible /v1/chat/completions
 * Accepts request from VS Code Continue.dev extension
 */
app.post('/v1/chat/completions', (req, res) => {
  const { messages, model, stream, tools, tool_choice } = req.json || req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: { message: "Invalid messages configuration" } });
  }

  const requestId = `req-${uuidv4().substring(0, 8)}`;
  console.log(`[OpenAI Endpoint] Received request ${requestId} (stream: ${!!stream}, model: ${model || 'human'}, tools_count: ${tools ? tools.length : 0})`);

  // If streaming is requested, open the SSE connection immediately
  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable proxy buffering for instant stream
    });
    // Send initial headers/whitespace to flush the SSE buffer
    res.write(': ping\n\n');
  }

  // Register in-memory
  const record = requestsStore.addRequest(requestId, messages, model || 'human-model', !!stream, res, tools, tool_choice);

  // Broadcast the new request live to the dashboard
  io.emit('request:new', record);

  // If client breaks the connection early, flag it on the dashboard
  res.on('close', () => {
    const existing = requestsStore.getRequest(requestId);
    if (existing && existing.status === 'pending') {
      console.log(`[OpenAI Endpoint] Client closed connection for ${requestId} early (abandoned)`);
      const updated = requestsStore.updateRequest(requestId, { status: 'cancelled' });
      io.emit('request:updated', updated);
    }
  });
});

/**
 * Endpoint 2: GET /v1/models
 * Continue.dev queries available models of the OpenAI endpoint
 */
app.get('/v1/models', (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "human-model",
        object: "model",
        created: 1677610602,
        owned_by: "human-operator",
      }
    ]
  });
});

/**
 * Endpoint 3: Human Response POST /reply/:id
 * Resolves the pending user prompt with human instructions
 */
app.post('/reply/:id', async (req, res) => {
  const { id } = req.params;
  let { content, tool_calls } = req.body || {};

  if (!content && (!tool_calls || tool_calls.length === 0)) {
    return res.status(400).json({ error: "Response content or tool_calls is required" });
  }

  // Auto-detect JSON containing tool_calls or function_call if passed as content text
  if (!tool_calls && content && content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        tool_calls = parsed.tool_calls;
        content = parsed.content || null;
      } else if (parsed.function && parsed.name) {
        // legacy structure or shorthand
        tool_calls = [{
          id: parsed.id || `call_${uuidv4().substring(0, 8)}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : parsed.arguments
          }
        }];
        content = parsed.content || null;
      } else if (parsed.name && parsed.arguments) {
        // simple direct tool shorthand e.g. { name: "createFile", arguments: {...} }
        tool_calls = [{
          id: `call_${uuidv4().substring(0, 8)}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'object' ? JSON.stringify(parsed.arguments) : parsed.arguments
          }
        }];
        content = parsed.content || null;
      }
    } catch (e) {
      // Not valid JSON, continue with text content
    }
  }

  const requestRecord = requestsStore.getRequest(id);
  if (!requestRecord) {
    return res.status(404).json({ error: "Request not found or expired" });
  }

  if (requestRecord.status !== 'pending') {
    return res.status(400).json({ error: `Request already has status '${requestRecord.status}'` });
  }

  console.log(`[Reply Endpoint] Operator replied to ${id}. Streaming: ${requestRecord.stream}, tool_calls: ${!!tool_calls}`);

  // Update in-memory state and notify dashboard
  const updatedRecord = requestsStore.updateRequest(id, {
    status: 'fulfilled',
    response: content,
    tool_calls: tool_calls,
  });
  io.emit('request:updated', updatedRecord);

  // Send reply code back to Continue.dev client
  const clientResponse = requestRecord.res;

  if (requestRecord.stream) {
    // Human is typing indicator can end
    io.emit('operator:typing', { id, isTyping: false });

    if (tool_calls && tool_calls.length > 0) {
      try {
        const payload = {
          id: `chatcmpl-${id}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestRecord.model,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: content || null,
                tool_calls: tool_calls.map((tc, index) => ({
                  index,
                  id: tc.id || `call_${uuidv4().substring(0, 8)}`,
                  type: tc.type || "function",
                  function: {
                    name: tc.function.name || tc.name,
                    arguments: typeof tc.function.arguments === 'string'
                      ? tc.function.arguments
                      : JSON.stringify(tc.function.arguments || tc.arguments)
                  }
                }))
              },
              finish_reason: "tool_calls"
            }
          ]
        };
        clientResponse.write(`data: ${JSON.stringify(payload)}\n\n`);
        
        // Push progress to operator dashboard
        io.emit('reply:token', { id, token: `[Tool Call: ${(tool_calls[0].function && tool_calls[0].function.name) || tool_calls[0].name}]` });
        
        clientResponse.write('data: [DONE]\n\n');
        clientResponse.end();
        console.log(`[Reply Endpoint] Finished streaming tool call response for ${id}`);
      } catch (err) {
        console.error(`[Reply Endpoint] Error during tool call streaming: ${err.message}`);
      }
    } else {
      // Stream the human content back in chunks resembling tokens with delays
      // We match alphanumeric words, punctuations, and space blocks
      const chunks = content.match(/[^\s]+|\s+/g) || [content];
      
      try {
        for (const chunk of chunks) {
          const payload = {
            id: `chatcmpl-${id}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestRecord.model,
            choices: [
              {
                index: 0,
                delta: { content: chunk },
                finish_reason: null
              }
            ]
          };
          
          clientResponse.write(`data: ${JSON.stringify(payload)}\n\n`);
          
          // Push intermediate tokens to operator dash to show real-time stream status
          io.emit('reply:token', { id, token: chunk });

          // Wait with a human typing emulation delay
          // Shorter delays for spaces, standard for words
          const delay = chunk.trim() === '' ? 5 : Math.max(15, Math.min(60, chunk.length * 8));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Send the finish signal chunk
        const finalPayload = {
          id: `chatcmpl-${id}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestRecord.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop"
            }
          ]
        };
        clientResponse.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
        clientResponse.write('data: [DONE]\n\n');
        clientResponse.end();
        
        console.log(`[Reply Endpoint] Finished streaming response for ${id}`);
      } catch (err) {
        console.error(`[Reply Endpoint] Error during streaming output: ${err.message}`);
      }
    }
  } else {
    // Non-streaming completion format response
    const payload = {
      id: `chatcmpl-${id}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestRecord.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            ...(tool_calls && tool_calls.length > 0 ? {
              tool_calls: tool_calls.map(tc => ({
                id: tc.id || `call_${uuidv4().substring(0, 8)}`,
                type: tc.type || "function",
                function: {
                  name: tc.function.name || tc.name,
                  arguments: typeof tc.function.arguments === 'string'
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments || tc.arguments)
                }
              }))
            } : {})
          },
          finish_reason: tool_calls && tool_calls.length > 0 ? "tool_calls" : "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: tool_calls ? 50 : content.split(/\s+/).length,
        total_tokens: tool_calls ? 50 : content.split(/\s+/).length,
      }
    };
    clientResponse.json(payload);
    console.log(`[Reply Endpoint] Dispatched full JSON reply for ${id}`);
  }

  res.status(200).json({ status: 'success', message: 'Reply sent successfully' });
});

/**
 * Typing status helper to show Continue.dev/dashboard live updates
 */
app.post('/typing/:id', (req, res) => {
  const { id } = req.params;
  const { isTyping } = req.body || {};
  io.emit('operator:typing', { id, isTyping: !!isTyping });
  res.sendStatus(200);
});

/**
 * Endpoint 4: Get smart response draft suggestions from Gemini
 * Uses the available GEMINI_API_KEY with the @google/genai SDK
 */
app.post('/api/gemini/suggest', async (req, res) => {
  const { messages } = req.body || {};
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "No messages context provided" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return res.status(503).json({ error: "Gemini API key is not configured in Secrets. Configure it in secrets to get replies auto-drafted." });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    // Format the conversation history for Gemini
    const userPrompt = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    const fullConversation = messages.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n');

    const promptText = `You are a helpful and professional AI Co-Operator assisting a human software operator inside an editing console.
The user is requesting help with code or a generic technical prompt.
Please analyze the following conversation context and provide a highly useful, accurate, and complete programming or technical response draft that writing operators can use directly.
Keep your response concise but extremely helpful, providing well-formatted code blocks where appropriate. Do NOT add any conversational meta-text like "Here is your response draft:" or conversational preamble. Start directly with the suggested answer/code.

CONTEXT CONVERSATION:
${fullConversation}

PROMPT DEFINITION:
${userPrompt}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
    });

    const suggestion = response.text || "";
    return res.json({ status: 'success', suggestion });
  } catch (error) {
    console.error(`[Gemini Engine] Error generating draft: ${error.message}`);
    return res.status(500).json({ error: `Gemini suggestion failed: ${error.message}` });
  }
});

/**
 * Endpoint 5: Interactive Simulator for sandbox prototyping
 * Generates mock pending developer requests inside the console queue
 */
app.post('/api/simulate', (req, res) => {
  const demoPrompts = [
    {
      messages: [
        { role: "user", content: "Can you write an elegant React counter component? Use Tailwind CSS to style it beautifully. Make it use simple states and display buttons to increment and decrement." }
      ],
      model: "react-sandbox"
    },
    {
      messages: [
        { role: "user", content: "Write a high-performance Python function that calculates the nth Fibonacci number. Use dynamic programming with memoization, and add type hints." }
      ],
      model: "python-runner"
    },
    {
      messages: [
        { role: "user", content: "How do I configure a basic multi-stage Dockerfile for a NestJS application to reduce image size? Explain why each stage is used." }
      ],
      model: "docker-agent"
    },
    {
      messages: [
        { role: "user", content: "The following TypeScript code has a bug where it throws an error 'Cannot read properties of undefined (reading 'map')'. Why? How can I fix it?\n\n```typescript\ninterface Box {\n  items?: string[];\n}\n\nfunction renderBox(box: Box) {\n  return box.items.map(it => `<li>\${it}</li>`);\n}\n```" }
      ],
      model: "bug-finder"
    }
  ];

  // Pick a random prompt
  const randomIndex = Math.floor(Math.random() * demoPrompts.length);
  const selected = demoPrompts[randomIndex];
  
  const requestId = `demo-${uuidv4().substring(0, 8)}`;
  console.log(`[Simulator] Spawning demo request \${requestId}`);

  // Create mock streaming response object
  const mockRes = {
    write: (data) => console.log(`[Demo Client \${requestId}] \${data}`),
    writeHead: () => {},
    end: () => console.log(`[Demo Client \${requestId}] Stream ended`),
    status: function() { return this; },
    json: () => {},
  };

  const record = requestsStore.addRequest(requestId, selected.messages, selected.model, true, mockRes);
  
  // Broadcast live via Socket.IO
  io.emit('request:new', record);

  res.json({ status: 'success', message: 'Demo request simulated successfully!', request: record });
});

// Capture global port listener
httpServer.listen(port, () => {
  console.log(`================================================================`);
  console.log(`🚀 Continue.dev Custom AI Provider is active on http://localhost:${port}`);
  console.log(`💻 Web Operator Dashboard is accessible at http://localhost:${port}/dashboard`);
  console.log(`🔧 Configure your Continue config.json with target endpoint:`);
  console.log(`   http://localhost:3000/v1`);
  console.log(`================================================================`);
});

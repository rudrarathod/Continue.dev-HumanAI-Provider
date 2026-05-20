import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import { requestsStore } from './requests.js';

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
  const { messages, model, stream } = req.json || req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: { message: "Invalid messages configuration" } });
  }

  const requestId = `req-${uuidv4().substring(0, 8)}`;
  console.log(`[OpenAI Endpoint] Received request ${requestId} (stream: ${!!stream}, model: ${model || 'human'})`);

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
  const record = requestsStore.addRequest(requestId, messages, model || 'human-model', !!stream, res);

  // Broadcast the new request live to the dashboard
  io.emit('request:new', record);

  // If client breaks the connection early, flag it on the dashboard
  req.on('close', () => {
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
  const { content } = req.body || {};

  if (!content) {
    return res.status(400).json({ error: "Response content is required" });
  }

  const requestRecord = requestsStore.getRequest(id);
  if (!requestRecord) {
    return res.status(404).json({ error: "Request not found or expired" });
  }

  if (requestRecord.status !== 'pending') {
    return res.status(400).json({ error: `Request already has status '${requestRecord.status}'` });
  }

  console.log(`[Reply Endpoint] Operator replied to ${id}. Streaming: ${requestRecord.stream}`);

  // Update in-memory state and notify dashboard
  const updatedRecord = requestsStore.updateRequest(id, {
    status: 'fulfilled',
    response: content,
  });
  io.emit('request:updated', updatedRecord);

  // Send reply code back to Continue.dev client
  const clientResponse = requestRecord.res;

  if (requestRecord.stream) {
    // Human is typing indicator can end
    io.emit('operator:typing', { id, isTyping: false });

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
            content: content
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: content.split(/\s+/).length,
        total_tokens: content.split(/\s+/).length,
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

// Capture global port listener
httpServer.listen(port, () => {
  console.log(`================================================================`);
  console.log(`🚀 Continue.dev Custom AI Provider is active on http://localhost:${port}`);
  console.log(`💻 Web Operator Dashboard is accessible at http://localhost:${port}/dashboard`);
  console.log(`🔧 Configure your Continue config.json with target endpoint:`);
  console.log(`   http://localhost:3000/v1`);
  console.log(`================================================================`);
});

/**
 * Requests Manager - In-Memory Database for Continue.dev Human Queue
 * Stores pending requests, active SSE/HTTP connections, and history.
 */

class RequestsStore {
  constructor() {
    this.requests = new Map(); // stores active & historical requests
    this.maxHistorySize = 100; // auto-clean history
    this.expireTimeoutMs = 10 * 60 * 1000; // auto-expire requests older than 10 mins if not answered
  }

  /**
   * Add a new request to the queue
   */
  addRequest(id, messages, model, stream, res) {
    const request = {
      id,
      timestamp: Date.now(),
      messages,
      model,
      stream,
      status: 'pending',
      response: null,
      res, // Store the response object so we can reply async
    };

    this.requests.set(id, request);
    this.scheduleExpiry(id);
    this.cleanupHistory();
    return this.serializeRequest(request);
  }

  /**
   * Get a full request record including raw connections
   */
  getRequest(id) {
    return this.requests.get(id);
  }

  /**
   * Get all active (pending) requests
   */
  getPendingRequests() {
    const pendingList = [];
    for (const req of this.requests.values()) {
      if (req.status === 'pending') {
        pendingList.push(this.serializeRequest(req));
      }
    }
    // Sort oldest first for queue order
    return pendingList.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get request list (history + pending) sorted by latest timestamp
   */
  getHistory() {
    const historyList = [];
    for (const req of this.requests.values()) {
      historyList.push(this.serializeRequest(req));
    }
    return historyList.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Updates state of a request
   */
  updateRequest(id, data) {
    const req = this.requests.get(id);
    if (!req) return null;
    
    Object.assign(req, data);
    return this.serializeRequest(req);
  }

  /**
   * Helper to serialize a request object for client/Socket.IO consumption
   * (Stripping out the raw Express response object to avoid circular JSON)
   */
  serializeRequest(req) {
    if (!req) return null;
    return {
      id: req.id,
      timestamp: req.timestamp,
      messages: req.messages,
      model: req.model,
      stream: req.stream,
      status: req.status,
      response: req.response,
    };
  }

  /**
   * Schedule automatic expiry for pending requests
   */
  scheduleExpiry(id) {
    setTimeout(() => {
      const req = this.requests.get(id);
      if (req && req.status === 'pending') {
        req.status = 'expired';
        
        // Notify the client before closing
        try {
          if (req.stream) {
            req.res.write(`data: ${JSON.stringify({ error: "Operator request expired after 10 minutes without response." })}\n\n`);
            req.res.write('data: [DONE]\n\n');
          } else {
            req.res.status(504).json({ error: "Operator request expired." });
          }
          req.res.end();
        } catch (e) {
          // connection already discarded
        }
      }
    }, this.expireTimeoutMs);
  }

  /**
   * Prune history to prevent memory leak
   */
  cleanupHistory() {
    if (this.requests.size <= this.maxHistorySize) return;

    // Get list of requests sorted by timestamp oldest first
    const sorted = [...this.requests.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Remove oldest resolved/expired items
    for (const [id, req] of sorted) {
      if (req.status !== 'pending' && this.requests.size > this.maxHistorySize) {
        this.requests.delete(id);
      }
    }
  }
}

// Singleton instances are perfect for keeping in-memory state in Node.js modules
export const requestsStore = new RequestsStore();

/**
 * Operator Dashboard Application Script
 * Real-time state synchronization, socket communication, HTML DOM binding
 */

// Initialize socket connection using default namespace (same host)
const socket = io();

// State variables
let state = {
  pending: [],
  history: [],
  selectedId: null,
  activeFilter: 'all', // 'all' or 'pending'
};

// DOM Cache
const dom = {
  connectionBadge: document.getElementById('connection-badge'),
  systemTime: document.getElementById('system-time'),
  queueCount: document.getElementById('queue-count'),
  fulfilledCount: document.getElementById('fulfilled-count'),
  filterAll: document.getElementById('filter-all'),
  filterPending: document.getElementById('filter-pending'),
  requestList: document.getElementById('request-list'),
  emptyState: document.getElementById('empty-state'),
  replyContainer: document.getElementById('reply-container'),
  noSelectionState: document.getElementById('no-selection-state'),
  activePanel: document.getElementById('active-panel'),
  activeBadgeStatus: document.getElementById('active-badge-status'),
  activeId: document.getElementById('active-id'),
  activeModel: document.getElementById('active-model'),
  activeStreamBadge: document.getElementById('active-stream-badge'),
  activeMessages: document.getElementById('active-messages'),
  typingIndicator: document.getElementById('typing-indicator'),
  replyTextarea: document.getElementById('reply-textarea'),
  statWords: document.getElementById('stat-words'),
  statChars: document.getElementById('stat-chars'),
  presetsContainer: document.getElementById('presets-container'),
  cancelReplyBtn: document.getElementById('cancel-reply-btn'),
  sendReplyBtn: document.getElementById('send-reply-btn'),
  deliveryStatus: document.getElementById('delivery-status'),
  footerApiUrl: document.getElementById('footer-api-url'),
};

// Map current URL to standard output
dom.footerApiUrl.textContent = `${window.location.origin}/v1`;

// Sync clocks
function updateClock() {
  const now = new Date();
  dom.systemTime.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}
setInterval(updateClock, 1000);
updateClock();

/**
 * Socket.IO Connection Event listeners
 */
socket.on('connect', () => {
  console.log('Connected to operator backend Socket.IO');
  dom.connectionBadge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-medium border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 flex items-center gap-1.5 transition-all duration-300';
  dom.connectionBadge.innerHTML = '<i data-lucide="wifi" class="w-3.5 h-3.5 animate-pulse"></i> <span>ONLINE</span>';
  lucide.createIcons();
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  dom.connectionBadge.className = 'px-3 py-1.5 rounded-full text-xs font-mono font-medium border border-red-500/20 bg-red-500/10 text-red-400 flex items-center gap-1.5 transition-all duration-300';
  dom.connectionBadge.innerHTML = '<i data-lucide="wifi-off" class="w-3.5 h-3.5"></i> <span>DISCONNECTED</span>';
  lucide.createIcons();
});

// Sync data list on init
socket.on('init', (data) => {
  console.log('Init payload received:', data);
  state.pending = data.pending || [];
  state.history = data.history || [];
  renderDashboard();
});

// A new request has arrived in active queue
socket.on('request:new', (req) => {
  console.log('New request arrived:', req);
  state.pending.push(req);
  state.history.unshift(req);
  
  // Play subtle visual/audio alert inside console
  playAlertNotification();
  renderDashboard();

  // Highlight or select automatically if no item selected
  if (!state.selectedId) {
    selectRequest(req.id);
  }
});

// Any state mutation (fulfilled, cancelled, expired)
socket.on('request:updated', (updatedReq) => {
  console.log('Request state updated:', updatedReq);
  
  // Update in state collections
  state.pending = state.pending.map(r => r.id === updatedReq.id ? updatedReq : r).filter(r => r.status === 'pending');
  state.history = state.history.map(r => r.id === updatedReq.id ? updatedReq : r);
  
  if (state.selectedId === updatedReq.id) {
    // Re-render the active panel info
    renderActivePanel(updatedReq);
  }
  
  renderDashboard();
});

// Live output streaming confirmation indicator
socket.on('reply:token', ({ id, token }) => {
  if (state.selectedId === id) {
    dom.deliveryStatus.innerHTML = `<span class="text-indigo-400 font-mono flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-indigo-500 animate-ping"></span> streaming tokens...</span>`;
  }
});

// Operator Typing feedback state
socket.on('operator:typing', ({ id, isTyping }) => {
  if (state.selectedId === id) {
    if (isTyping) {
      dom.typingIndicator.style.opacity = '1';
    } else {
      dom.typingIndicator.style.opacity = '0';
    }
  }
});

/**
 * Handle filtering
 */
dom.filterAll.addEventListener('click', () => {
  state.activeFilter = 'all';
  dom.filterAll.className = 'px-2.5 py-1 rounded bg-slate-800 text-slate-100 font-medium transition-all';
  dom.filterPending.className = 'px-2.5 py-1 rounded hover:text-slate-100 transition-all';
  renderQueueList();
});

dom.filterPending.addEventListener('click', () => {
  state.activeFilter = 'pending';
  dom.filterPending.className = 'px-2.5 py-1 rounded bg-slate-800 text-slate-100 font-medium transition-all';
  dom.filterAll.className = 'px-2.5 py-1 rounded hover:text-slate-100 transition-all';
  renderQueueList();
});

/**
 * Render the full dashboard application state
 */
function renderDashboard() {
  // Update stats
  dom.queueCount.textContent = state.pending.length;
  
  const fulfilledCount = state.history.filter(r => r.status === 'fulfilled').length;
  dom.fulfilledCount.textContent = fulfilledCount;
  
  renderQueueList();
}

/**
 * Render the scrollable left list
 */
function renderQueueList() {
  // Determine list based on selected filter
  let list = state.activeFilter === 'pending' ? state.pending : state.history;

  // Clear listing (excluding empty state)
  const children = Array.from(dom.requestList.children);
  children.forEach(c => {
    if (c !== dom.emptyState) {
      dom.requestList.removeChild(c);
    }
  });

  if (list.length === 0) {
    dom.emptyState.classList.remove('hidden');
    return;
  }
  
  dom.emptyState.classList.add('hidden');

  list.forEach(req => {
    const card = document.createElement('div');
    const isSelected = state.selectedId === req.id;
    
    // Choose styling variables based on status
    let statusColor = 'bg-slate-800 text-slate-400';
    let borderColor = isSelected ? 'border-indigo-500/85 bg-slate-900/90' : 'border-slate-800/80 bg-[#0c1220]/60 hover:border-slate-800';
    
    if (req.status === 'pending') {
      statusColor = 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
    } else if (req.status === 'fulfilled') {
      statusColor = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    } else if (req.status === 'cancelled') {
      statusColor = 'bg-amber-500/10 text-amber-500 border border-amber-500/10';
    } else if (req.status === 'expired') {
      statusColor = 'bg-red-500/10 text-red-400 border border-red-500/10';
    }

    card.className = `p-3.5 rounded-xl border ${borderColor} cursor-pointer request-card-anim transition-all flex flex-col space-y-2 relative overflow-hidden`;
    card.setAttribute('id', `list-card-${req.id}`);
    
    // Extract last prompt from developer's message tree
    const lastUserPrompt = getLastUserPrompt(req.messages);
    const prettyTime = new Date(req.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    card.innerHTML = `
      <div class="flex items-center justify-between pointer-events-none">
        <div class="flex items-center space-x-2">
          <span class="text-xs font-mono font-bold tracking-tight text-slate-300">${req.id}</span>
          <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium ${statusColor}">${req.status}</span>
        </div>
        <span class="text-[10px] text-slate-500 font-mono">${prettyTime}</span>
      </div>
      
      <p class="text-xs text-slate-400 font-sans line-clamp-1 truncate select-none pointer-events-none">
        ${escapeHTML(lastUserPrompt)}
      </p>

      <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono pointer-events-none pt-0.5">
        <span class="flex items-center gap-1">
          <i data-lucide="cpu" class="w-3 h-3 text-indigo-400/75"></i>
          ${req.model}
        </span>
        <span class="flex items-center gap-1 ${req.stream ? 'text-indigo-400' : 'text-slate-500'}">
          <i data-lucide="${req.stream ? 'zap' : 'text-align-justify'}" class="w-3 h-3"></i>
          ${req.stream ? 'SSE STREAM' : 'STATIC'}
        </span>
      </div>
    `;

    card.addEventListener('click', () => {
      selectRequest(req.id);
    });

    dom.requestList.appendChild(card);
  });

  lucide.createIcons();
}

/**
 * Switch selected requests panel
 */
function selectRequest(id) {
  state.selectedId = id;
  
  // Highlight in left list
  const currentCards = dom.requestList.querySelectorAll('[id^="list-card-"]');
  currentCards.forEach(c => {
    const isThisOne = c.getAttribute('id') === `list-card-${id}`;
    c.className = isThisOne 
      ? `p-3.5 rounded-xl border border-indigo-500 bg-indigo-500/5 cursor-pointer request-card-anim transition-all flex flex-col space-y-2 relative overflow-hidden`
      : `p-3.5 rounded-xl border border-slate-800 bg-[#0c1220]/60 hover:border-slate-800 cursor-pointer request-card-anim transition-all flex flex-col space-y-2 relative overflow-hidden`;
  });

  const fullRecord = state.history.find(r => r.id === id);
  if (fullRecord) {
    dom.noSelectionState.classList.add('hidden');
    dom.activePanel.classList.remove('hidden');
    renderActivePanel(fullRecord);
  }
}

/**
 * Helper to pull the final Prompt instruction
 */
function getLastUserPrompt(messages) {
  if (!messages || messages.length === 0) return 'Empty content request.';
  const users = messages.filter(m => m.role === 'user');
  if (users.length > 0) {
    return users[users.length - 1].content;
  }
  return messages[messages.length - 1].content || 'Empty payload request.';
}

/**
 * Render Right Side Workspace Detail
 */
function renderActivePanel(req) {
  dom.activeId.textContent = req.id;
  dom.activeModel.textContent = req.model;
  
  // Setup Stream Banner Indicator
  if (req.stream) {
    dom.activeStreamBadge.innerHTML = '<i data-lucide="zap" class="w-3.5 h-3.5 text-indigo-400 animate-pulse"></i> <span>STREAM ENABLED</span>';
    dom.activeStreamBadge.className = 'flex items-center gap-1 text-indigo-400 font-semibold';
  } else {
    dom.activeStreamBadge.innerHTML = '<i data-lucide="text-align-justify" class="w-3.5 h-3.5 text-slate-500"></i> <span>STATIC REST</span>';
    dom.activeStreamBadge.className = 'flex items-center gap-1 text-slate-500';
  }

  // Setup badge text & styling based on Status
  dom.activeBadgeStatus.textContent = req.status;
  if (req.status === 'pending') {
    dom.activeBadgeStatus.className = 'px-2 py-0.5 rounded-md text-[10px] font-mono tracking-wider font-semibold uppercase bg-orange-500/15 text-orange-400 border border-orange-500/20';
    dom.sendReplyBtn.disabled = false;
    dom.sendReplyBtn.className = 'px-5 py-2 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl flex items-center gap-2 shadow-lg hover:shadow-indigo-500/20 active-glow transition-all';
    dom.deliveryStatus.textContent = 'Awaiting manual entry...';
    
    // Clear textarea for fresh entries
    dom.replyTextarea.value = '';
    updateStatsCounter();
    dom.replyTextarea.disabled = false;
  } else {
    dom.replyTextarea.value = req.response || '';
    dom.replyTextarea.disabled = true;
    updateStatsCounter();

    dom.sendReplyBtn.disabled = true;
    dom.sendReplyBtn.className = 'px-5 py-2 text-xs font-semibold bg-slate-800 text-slate-500 rounded-xl flex items-center gap-2 cursor-not-allowed border border-slate-700/50';

    if (req.status === 'fulfilled') {
      dom.activeBadgeStatus.className = 'px-2 py-0.5 rounded-md text-[10px] font-mono tracking-wider font-semibold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';
      dom.deliveryStatus.textContent = 'Completed and dispatched to client.';
    } else if (req.status === 'cancelled') {
      dom.activeBadgeStatus.className = 'px-2 py-0.5 rounded-md text-[10px] font-mono tracking-wider font-semibold uppercase bg-amber-500/10 text-amber-500 border border-amber-500/10';
      dom.deliveryStatus.textContent = 'VS Code closed connection/cancelled request.';
    } else {
      dom.activeBadgeStatus.className = 'px-2 py-0.5 rounded-md text-[10px] font-mono tracking-wider font-semibold uppercase bg-red-500/10 text-red-400 border border-red-500/10';
      dom.deliveryStatus.textContent = 'Request timed out after waiting 10 minutes.';
    }
  }

  // Populate Messages
  dom.activeMessages.innerHTML = '';
  req.messages.forEach(m => {
    const isUser = m.role === 'user';
    const msgBlock = document.createElement('div');
    
    msgBlock.className = isUser 
      ? 'bg-[#11192e] border border-slate-800/80 p-3.5 rounded-xl space-y-1'
      : 'bg-indigo-950/20 border border-indigo-900/30 p-3.5 rounded-xl space-y-1';

    const roleName = isUser ? 'User Prompt' : 'Context Assistant';
    const roleIcon = isUser ? 'user' : 'bot';
    const badgeColor = isUser ? 'text-indigo-400' : 'text-violet-400';

    // Parse Markdown safely on client
    const htmlContent = marked.parse(m.content || '');

    msgBlock.innerHTML = `
      <div class="flex items-center space-x-1.5 text-xs ${badgeColor} font-mono font-medium mb-1">
        <i data-lucide="${roleIcon}" class="w-3.5 h-3.5"></i>
        <span>${roleName}</span>
      </div>
      <div class="markdown-body text-xs text-slate-300 overflow-x-auto">
        ${htmlContent}
      </div>
    `;

    dom.activeMessages.appendChild(msgBlock);
  });

  lucide.createIcons();
}

/**
 * Textarea stats counter
 */
function updateStatsCounter() {
  const text = dom.replyTextarea.value;
  dom.statChars.textContent = text.length;
  dom.statWords.textContent = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

dom.replyTextarea.addEventListener('input', () => {
  updateStatsCounter();
  
  // Trigger Typing status
  notifyTyping(state.selectedId, true);
});

// Debounce typing status triggers
let typingTimeout = null;
function notifyTyping(id, isTyping) {
  if (!id) return;

  if (isTyping) {
    if (typingTimeout) clearTimeout(typingTimeout);
    
    // Broadcast status
    fetch(`/typing/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping: true }),
    }).catch(() => {});

    // Schedule stop typing feedback after 2 seconds
    typingTimeout = setTimeout(() => {
      notifyTyping(id, false);
    }, 2000);
  } else {
    fetch(`/typing/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTyping: false }),
    }).catch(() => {});
  }
}

/**
 * Handle presets template selections
 */
dom.presetsContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('preset-btn')) {
    const textToInsert = e.target.textContent.trim();
    
    // If input is empty or has placeholder, replace/append
    if (dom.replyTextarea.disabled) return;
    
    if (dom.replyTextarea.value.trim() === '') {
      dom.replyTextarea.value = textToInsert + '\n\n';
    } else {
      dom.replyTextarea.value += ' ' + textToInsert;
    }
    
    dom.replyTextarea.focus();
    updateStatsCounter();
  }
});

/**
 * Clear and reset textarea
 */
dom.cancelReplyBtn.addEventListener('click', () => {
  if (dom.replyTextarea.disabled) return;
  dom.replyTextarea.value = '';
  updateStatsCounter();
  dom.replyTextarea.focus();
});

/**
 * Dispatch / Reply Trigger (POST /reply/:id)
 */
dom.sendReplyBtn.addEventListener('click', async () => {
  const content = dom.replyTextarea.value.trim();
  const id = state.selectedId;

  if (!id || !content) {
    alert('Please enter a response message before dispatching!');
    return;
  }

  // Update button state visually
  dom.sendReplyBtn.disabled = true;
  dom.sendReplyBtn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> <span>Sending...</span>';
  lucide.createIcons();

  try {
    const response = await fetch(`/reply/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    const parsed = await response.json();
    if (response.ok) {
      dom.deliveryStatus.textContent = 'Reply synced and streaming!';
    } else {
      dom.deliveryStatus.textContent = `Error: ${parsed.error || 'Failed to dispatch'}`;
      dom.sendReplyBtn.disabled = false;
      dom.sendReplyBtn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Dispatch Response</span>';
      lucide.createIcons();
    }
  } catch (error) {
    dom.deliveryStatus.textContent = 'Network offline or server died.';
    dom.sendReplyBtn.disabled = false;
    dom.sendReplyBtn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Dispatch Response</span>';
    lucide.createIcons();
  }
});

/**
 * Quality-of-life UI sounds & events helpers
 */
function playAlertNotification() {
  // If the browser has a window context, trigger local desktop audio chime
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') {
      return; // silent if audio sandbox is restricted (needs user interaction first)
    }
    const osc = context.createOscillator();
    const gain = context.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, context.currentTime); // D5 note
    osc.frequency.setValueAtTime(880.00, context.currentTime + 0.08); // A5 note
    
    gain.gain.setValueAtTime(0.04, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    
    osc.connect(gain);
    gain.connect(context.destination);
    
    osc.start();
    osc.stop(context.currentTime + 0.3);
  } catch (e) {
    // browser blocked play context
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

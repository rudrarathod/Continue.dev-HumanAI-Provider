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
  pasteSendBtn: document.getElementById('paste-send-btn'),
  sendReplyBtn: document.getElementById('send-reply-btn'),
  deliveryStatus: document.getElementById('delivery-status'),
  footerApiUrl: document.getElementById('footer-api-url'),
  toolsPanel: document.getElementById('tools-panel'),
  toolsList: document.getElementById('tools-list'),
  toolBuilder: document.getElementById('tool-builder'),
  selectedToolName: document.getElementById('selected-tool-name'),
  toolPathInput: document.getElementById('tool-path-input'),
  toolParamsInput: document.getElementById('tool-params-input'),
  toolContentInput: document.getElementById('tool-content-input'),
  toolCancelBuilderBtn: document.getElementById('tool-cancel-builder-btn'),
  toolGenerateJsonBtn: document.getElementById('tool-generate-json-btn'),
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

  // Handle tools display
  if (req.tools && req.tools.length > 0 && req.status === 'pending') {
    dom.toolsPanel.classList.remove('hidden');
    dom.toolsList.innerHTML = '';
    
    req.tools.forEach(tool => {
      const toolName = (tool.function && tool.function.name) || tool.name;
      const toolDesc = (tool.function && tool.function.description) || tool.description || 'No description';
      
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-indigo-300 hover:text-indigo-200 border border-indigo-500/10 hover:border-indigo-400/40 rounded-lg font-mono font-medium transition-all cursor-pointer flex items-center gap-1';
      badge.innerHTML = `<i data-lucide="cog" class="w-3.5 h-3.5 text-indigo-400"></i> <span>${toolName}</span>`;
      badge.title = toolDesc;
      
      badge.addEventListener('click', () => {
        openToolBuilder(tool);
      });
      
      dom.toolsList.appendChild(badge);
    });
  } else {
    dom.toolsPanel.classList.add('hidden');
    dom.toolBuilder.classList.add('hidden');
  }

  // Populate Messages
  dom.activeMessages.innerHTML = '';
  req.messages.forEach((m, idx) => {
    const isUser = m.role === 'user';
    const msgBlock = document.createElement('div');
    
    msgBlock.className = isUser 
      ? 'bg-[#11192e] border border-slate-800/80 p-3.5 rounded-xl space-y-1.5 relative group'
      : 'bg-indigo-950/20 border border-indigo-900/30 p-3.5 rounded-xl space-y-1.5 relative group';

    const roleName = isUser ? 'User Prompt' : 'Context Assistant';
    const roleIcon = isUser ? 'user' : 'bot';
    const badgeColor = isUser ? 'text-indigo-400' : 'text-violet-400';

    // Parse Markdown safely on client
    const htmlContent = marked.parse(m.content || '');

    msgBlock.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center space-x-1.5 text-xs ${badgeColor} font-mono font-medium">
          <i data-lucide="${roleIcon}" class="w-3.5 h-3.5"></i>
          <span>${roleName}</span>
        </div>
        <button class="msg-copy-btn px-2 py-0.5 text-[9px] font-mono text-slate-400 hover:text-indigo-400 border border-transparent hover:border-indigo-500/20 hover:bg-indigo-500/5 rounded opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 cursor-pointer" data-idx="${idx}">
          <i data-lucide="copy" class="w-2.5 h-2.5"></i>
          <span>Copy</span>
        </button>
      </div>
      <div class="markdown-body text-xs text-slate-300 overflow-x-auto">
        ${htmlContent}
      </div>
    `;

    // Hook copy segment
    msgBlock.querySelector('.msg-copy-btn').addEventListener('click', (e) => {
      copyToClipboard(m.content || '', e.currentTarget);
    });

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
 * Automated Reply Sender Helper
 */
async function sendReply(content) {
  const id = state.selectedId;

  if (!id || !content) {
    showToast('Please enter a response message before dispatching!', 'warning');
    return;
  }

  // Update button states visually
  dom.sendReplyBtn.disabled = true;
  dom.sendReplyBtn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> <span>Sending...</span>';
  if (dom.pasteSendBtn) {
    dom.pasteSendBtn.disabled = true;
    dom.pasteSendBtn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> <span>Sending...</span>';
  }
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
      showToast('Response successfully synced and streaming to client!', 'success');
    } else {
      dom.deliveryStatus.textContent = `Error: ${parsed.error || 'Failed to dispatch'}`;
      showToast(`Dispatch failed: ${parsed.error || 'unspecified server error'}`, 'error');
    }
  } catch (error) {
    dom.deliveryStatus.textContent = 'Network offline or server died.';
    showToast('Network offline or operator backend is not responding.', 'error');
  } finally {
    dom.sendReplyBtn.disabled = false;
    dom.sendReplyBtn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5"></i> <span>Dispatch Response</span>';
    if (dom.pasteSendBtn) {
      dom.pasteSendBtn.disabled = false;
      dom.pasteSendBtn.innerHTML = '<i data-lucide="zap" class="w-3.5 h-3.5"></i> <span>Paste & Send</span>';
    }
    lucide.createIcons();
  }
}

/**
 * Dispatch / Reply Trigger (POST /reply/:id)
 */
dom.sendReplyBtn.addEventListener('click', () => {
  const content = dom.replyTextarea.value.trim();
  sendReply(content);
});

/**
 * Speed Shortcut: Paste & Send Trigger
 */
if (dom.pasteSendBtn) {
  dom.pasteSendBtn.addEventListener('click', async () => {
    if (dom.replyTextarea.disabled) {
      showToast('Cannot reply to currently resolved or inactive requests!', 'warning');
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        dom.deliveryStatus.textContent = 'Reading clipboard...';
        const clipboardText = await navigator.clipboard.readText();
        
        if (!clipboardText || clipboardText.trim() === '') {
          showToast('Clipboard appears to be empty! Copied text not found.', 'warning');
          dom.deliveryStatus.textContent = 'Ready to send.';
          return;
        }

        // Paste into textarea and trigger dispatch instantly
        dom.replyTextarea.value = clipboardText;
        updateStatsCounter();
        dom.deliveryStatus.textContent = 'Fast dispatching...';
        await sendReply(clipboardText.trim());
      } else {
        throw new Error('Clipboard API not supported');
      }
    } catch (err) {
      console.warn('Clipboard read failed: ', err);
      showToast('Safety sandbox blocked clipboard reading. Paste (Ctrl+V) into the text area then click Send!', 'warning');
      dom.deliveryStatus.textContent = 'Paste manually (Ctrl+V).';
      dom.replyTextarea.focus();
    }
  });
}

/**
 * Custom Non-Blocking Toast Notification System
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast-notification');
  const msgEl = document.getElementById('toast-message');
  const iconEl = document.getElementById('toast-icon');
  const iconInner = document.getElementById('toast-icon-inner');

  if (!toast || !msgEl || !iconEl || !iconInner) return;

  msgEl.textContent = message;

  // Set visual theme matching status type
  if (type === 'success') {
    iconEl.className = 'p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25';
    iconInner.setAttribute('data-lucide', 'check-circle');
  } else if (type === 'error') {
    iconEl.className = 'p-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/25';
    iconInner.setAttribute('data-lucide', 'alert-circle');
  } else if (type === 'warning') {
    iconEl.className = 'p-1.5 rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/25';
    iconInner.setAttribute('data-lucide', 'alert-triangle');
  } else {
    iconEl.className = 'p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 border border-indigo-500/25';
    iconInner.setAttribute('data-lucide', 'info');
  }
  
  lucide.createIcons();

  // Animate toast entry
  toast.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-2');
  toast.classList.add('opacity-100', 'translate-y-0');

  // Dismiss automatically after 4 seconds
  if (window.toastTimeout) clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(dismissToast, 4000);
}

function dismissToast() {
  const toast = document.getElementById('toast-notification');
  if (toast) {
    toast.classList.add('opacity-0', 'pointer-events-none');
    toast.classList.remove('opacity-100');
  }
}

document.getElementById('toast-close').addEventListener('click', dismissToast);

/**
 * Robust Clipboard Utility with Fallback for sandboxed iFrames
 */
function copyToClipboard(text, buttonElement) {
  const originalHTML = buttonElement.innerHTML;
  
  const performCopySuccess = () => {
    buttonElement.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i> <span class="text-emerald-400 font-bold">Copied!</span>';
    lucide.createIcons();
    showToast('Copied to clipboard successfully!', 'success');
    
    setTimeout(() => {
      buttonElement.innerHTML = originalHTML;
      lucide.createIcons();
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(performCopySuccess)
      .catch(() => fallbackCopy(text, performCopySuccess));
  } else {
    fallbackCopy(text, performCopySuccess);
  }
}

function fallbackCopy(text, successCallback) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      successCallback();
    } else {
      showToast('Unable to copy text. Please select and copy manually.', 'error');
    }
  } catch (err) {
    console.error('Fallback copy failed', err);
    showToast('Browser blocked copy operation.', 'error');
  }
  document.body.removeChild(textArea);
}

/**
 * Handle Full Context copying
 */
document.getElementById('copy-full-context-btn').addEventListener('click', (e) => {
  const activeReq = state.history.find(r => r.id === state.selectedId);
  if (!activeReq) {
    showToast('Please select a valid request first!', 'warning');
    return;
  }
  
  let instructions = `[SYSTEM INSTRUCTION FOR THE RECIPIENT AI MODEL]
You are acting as an API provider. Analyze the developer-assistant conversation below.
Your final answer must resolve the last developer request.

`;

  if (activeReq.tools && activeReq.tools.length > 0) {
    instructions += `CRITICAL CONFIGURATION:
The developer's client has requested these tool capabilities:
${JSON.stringify(activeReq.tools, null, 2)}

If the last developer prompt asks to write code, create or edit files, or execute/run terminal commands, you MUST respond with a single valid JSON block in one of the formats below.
Do not add conversational preamble. Output ONLY the raw JSON block.

IMPORTANT: The keys inside "arguments" MUST EXACTLY match the properties defined in the "parameters" or "input_schema" of the tool. For example:
- If the tool parameters schema specifies "filepath" instead of "path", you MUST use "filepath"!
- If the tool parameters schema specifies "content" or "code", you MUST use that exact key name!
- Do not default to "path" if the schema demands "filepath". Match the tool schema properties precisely.

JSON Format Option A (Direct single tool call shorthand):
{
  "name": "<name_of_the_tool_e.g_create_new_file_or_editFile>",
  "arguments": {
    "filepath": "<exact_file_path_specified_by_tool_parameters_key>",
    "content": "<exact_complete_code_body_to_write_or_edit_or_correct_key>"
  }
}

JSON Format Option B (OpenAI standard tool_calls wrapper):
{
  "tool_calls": [
    {
      "type": "function",
      "function": {
        "name": "<name_of_the_tool>",
        "arguments": {
          "filepath": "<exact_file_path_specified_by_tool_parameters_key>",
          "content": "<content_or_arguments>"
        }
      }
    }
  ]
}

Otherwise, if it is a general question or prompt, reply with clean raw markdown content.
---
`;
  } else {
    instructions += `Answer the question with helpful markdown and clear explanations.
---
`;
  }

  instructions += `CONVERSATION HISTORY:\n\n`;
  const formattedPrompt = instructions + activeReq.messages.map(m => `### ${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
  copyToClipboard(formattedPrompt, e.currentTarget);
});

/**
 * Handle Suggest Response with Gemini AI model
 */
document.getElementById('gemini-draft-btn').addEventListener('click', async (e) => {
  const id = state.selectedId;
  const activeReq = state.history.find(r => r.id === id);
  
  if (!id || !activeReq) {
    showToast('Please select an active queue request to generate a reply draft!', 'warning');
    return;
  }

  const draftBtn = e.currentTarget;
  if (draftBtn.disabled) return;

  draftBtn.disabled = true;
  const originalHTML = draftBtn.innerHTML;
  draftBtn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin text-purple-400"></i> <span>Formulating Draft...</span>';
  lucide.createIcons();
  
  showToast('Invoking server-side Gemini 3.5 Assistant...', 'info');

  try {
    const response = await fetch('/api/gemini/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: activeReq.messages, id: id }),
    });

    const data = await response.json();
    if (response.ok) {
      if (dom.replyTextarea.disabled) {
        showToast('Active request session is already resolved or closed!', 'warning');
      } else {
        dom.replyTextarea.value = data.suggestion || '';
        updateStatsCounter();
        showToast('Gemini suggested response draft loaded!', 'success');
        dom.replyTextarea.focus();
      }
    } else {
      showToast(data.error || 'Failed to formulate suggestion draft.', 'error');
    }
  } catch (err) {
    showToast('Failed to reach AI Suggestion module.', 'error');
  } finally {
    draftBtn.disabled = false;
    draftBtn.innerHTML = originalHTML;
    lucide.createIcons();
  }
});

/**
 * Hook up Sandbox Simulation requests
 */
const triggerSimulation = async () => {
  try {
    showToast('Simulating developer prompt injection...', 'info');
    const response = await fetch('/api/simulate', { method: 'POST' });
    const data = await response.json();
    
    if (response.ok) {
      showToast('Demo prompt registered in active queue successfully!', 'success');
    } else {
      showToast(`Simulation Error: ${data.error || 'unspecified error'}`, 'error');
    }
  } catch (err) {
    showToast('Failed to connect to simulation server endpoint.', 'error');
  }
};

document.getElementById('header-simulate-btn').addEventListener('click', triggerSimulation);
document.getElementById('simulate-empty-btn').addEventListener('click', triggerSimulation);

/**
 * Interactive Tool Form Builder Helpers & Event Bindings
 */
function openToolBuilder(tool) {
  const toolName = (tool.function && tool.function.name) || tool.name || 'customTool';
  dom.selectedToolName.textContent = toolName;
  dom.toolBuilder.classList.remove('hidden');
  
  // Store the active tool in the global state
  state.currentBuilderTool = tool;
  
  // Set values & placeholders based on common naming patterns
  dom.toolPathInput.value = '';
  dom.toolParamsInput.value = '';
  dom.toolContentInput.value = '';
  
  if (toolName.toLowerCase().includes('file')) {
    dom.toolPathInput.placeholder = "e.g. src/App.tsx";
    dom.toolContentInput.placeholder = "Write or edit the file code inside this block...";
  } else if (toolName.toLowerCase().includes('command') || toolName.toLowerCase().includes('exec') || toolName.toLowerCase().includes('terminal')) {
    dom.toolPathInput.placeholder = "e.g. npm run build";
    dom.toolContentInput.placeholder = "Enter shell command parameters or input...";
  } else {
    dom.toolPathInput.placeholder = "main argument (e.g. path, command)";
    dom.toolContentInput.placeholder = "Enter tool argument details or body code here...";
  }
}

dom.toolCancelBuilderBtn.addEventListener('click', () => {
  dom.toolBuilder.classList.add('hidden');
});

dom.toolGenerateJsonBtn.addEventListener('click', () => {
  const toolName = dom.selectedToolName.textContent;
  const pathVal = dom.toolPathInput.value.trim();
  const paramsVal = dom.toolParamsInput.value.trim();
  const contentVal = dom.toolContentInput.value;
  
  if (!toolName) {
    showToast('Please select an active tool badge first!', 'warning');
    return;
  }
  
  if (dom.replyTextarea.disabled) {
    showToast('Cannot generate tool payload for a resolved request!', 'warning');
    return;
  }
  
  // Dynamically inspect selected tool schema parameter names
  let fileKeyName = 'path';
  let contentKeyName = 'content';
  const checkTool = state.currentBuilderTool;
  
  if (checkTool) {
    const params = (checkTool.function && checkTool.function.parameters) || checkTool.parameters || checkTool.input_schema;
    if (params && params.properties) {
      // 1. Detect file/path target key name
      if ('filepath' in params.properties) {
        fileKeyName = 'filepath';
      } else if ('path' in params.properties) {
        fileKeyName = 'path';
      } else {
        const found = Object.keys(params.properties).find(k => k.toLowerCase().includes('path'));
        if (found) {
          fileKeyName = found;
        }
      }
      
      // 2. Detect content/code block target key name
      if ('content' in params.properties) {
        contentKeyName = 'content';
      } else if ('code' in params.properties) {
        contentKeyName = 'code';
      } else if ('text' in params.properties) {
        contentKeyName = 'text';
      } else {
        const found = Object.keys(params.properties).find(k => k.toLowerCase().includes('content') || k.toLowerCase().includes('code') || k.toLowerCase().includes('text'));
        if (found) {
          contentKeyName = found;
        }
      }
    }
  }

  const args = {};
  if (pathVal) {
    args[fileKeyName] = pathVal;
  }
  
  if (paramsVal) {
    try {
      const parsed = JSON.parse(paramsVal);
      Object.assign(args, parsed);
    } catch (e) {
      args.options = paramsVal;
    }
  }
  
  if (contentVal) {
    args[contentKeyName] = contentVal;
  }
  
  const payload = {
    name: toolName,
    arguments: args
  };
  
  dom.replyTextarea.value = JSON.stringify(payload, null, 2);
  updateStatsCounter();
  
  showToast(`Shorthand JSON payload for ${toolName} constructed!`, 'success');
  dom.toolBuilder.classList.add('hidden');
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

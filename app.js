/* ============================================================
   Friday AI Assistant — Main JavaScript
   app.js
   ============================================================ */
 
const BACKEND = "http://127.0.0.1:5000";
 
// ── State ──
let currentKey      = null;
let documentHistory = [];
let currentMode     = 'chat';
 
// Unique session ID per browser tab — used for memory isolation
const SESSION_ID = 'session-' + Math.random().toString(36).substr(2, 9);
 
 
/* ============================================================
   MODE SWITCHING
   ============================================================ */
function setMode(mode) {
  currentMode = mode;
 
  ['chat', 'voice', 'doc'].forEach(m => {
    document.getElementById('btn-' + m).classList.toggle('active', m === mode);
  });
 
  const titles    = { chat: 'Chat', voice: 'Voice', doc: 'Document Q&A' };
  const subtitles = { chat: 'TEXT MODE', voice: 'SPEECH MODE', doc: 'DOCUMENT MODE' };
 
  document.getElementById('topbarTitle').textContent = titles[mode];
  document.getElementById('topbarMode').textContent  = subtitles[mode];
 
  document.getElementById('docAskBar').classList.toggle('visible', mode === 'doc');
 
  const placeholders = {
    voice: 'Click 🎙️ to speak, or type...',
    doc:   'Chat normally, or use "Ask Document" below...',
    chat:  'Message Friday...',
  };
  document.getElementById('input').placeholder = placeholders[mode];
}
 
 
/* ============================================================
   UI HELPERS
   ============================================================ */
 
/** Auto-resize textarea as user types */
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
 
/** Send on Enter, newline on Shift+Enter */
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
}
 
/** Current time string for message timestamps */
function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
 
/** Pre-fill input and send immediately */
function quickSend(text) {
  document.getElementById('input').value = text;
  sendText();
}
 
 
/* ============================================================
   CHAT — ADD / REMOVE MESSAGES
   ============================================================ */
 
/**
 * Add a message bubble to the chat.
 * @param {'user'|'bot'} role
 * @param {string}       content
 * @param {boolean}      isTyping  - show animated dots instead of content
 */
function addMessage(role, content, isTyping = false) {
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.remove();
 
  const chat = document.getElementById('chat');
  const div  = document.createElement('div');
  div.className = 'msg ' + role;
 
  // Avatar
  const avatar = document.createElement('div');
  avatar.className   = 'avatar';
  avatar.textContent = role === 'user' ? '👤' : '✦';
 
  const wrapper = document.createElement('div');
 
  if (isTyping) {
    // Animated typing indicator
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.id        = 'typingBubble';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      bubble.appendChild(dot);
    }
    wrapper.appendChild(bubble);
    div.id = 'typingMsg';
 
  } else {
    // Web search badge (shown when response starts with 🌐)
    if (role === 'bot' && content.startsWith('🌐')) {
      const badge = document.createElement('span');
      badge.className   = 'web-badge';
      badge.textContent = '🌐 Web Search';
      wrapper.appendChild(badge);
    }
 
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
 
    if (role === 'bot') {
      bubble.appendChild(renderContent(content));
    } else {
      bubble.textContent = content; // plain text — safe, no XSS risk
    }
 
    const meta = document.createElement('div');
    meta.className   = 'msg-meta';
    meta.textContent = now();
 
    wrapper.appendChild(bubble);
    wrapper.appendChild(meta);
  }
 
  div.appendChild(avatar);
  div.appendChild(wrapper);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}
 
/** Remove the typing indicator bubble */
function removeTyping() {
  const t = document.getElementById('typingMsg');
  if (t) t.remove();
}
 
/** Reset chat UI and clear backend memory */
async function clearChat() {
  const chat = document.getElementById('chat');
  chat.innerHTML = `
    <div class="empty-state" id="emptyState">
      <div class="empty-icon">✦</div>
      <div class="empty-title">Start a conversation</div>
      <div class="empty-sub">Ask me anything, upload a document, or use your voice.</div>
      <div class="suggestions">
        <span class="sugg" onclick="quickSend('What can you help me with?')">What can you do?</span>
        <span class="sugg" onclick="quickSend('Explain quantum computing briefly')">Explain quantum computing</span>
        <span class="sugg" onclick="quickSend('Write a short poem about the ocean')">Write a poem</span>
      </div>
    </div>`;
 
  await fetch(`${BACKEND}/clear-memory`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ session_id: SESSION_ID })
  });
}
 
 
/* ============================================================
   CONTENT RENDERER (DOM-based — no innerHTML, no XSS)
   ============================================================ */
 
/** Returns true if a URL points to an image file */
function isImageUrl(url) {
  try {
    const path = new URL(url).pathname;
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(path);
  } catch {
    return /\.(jpg|jpeg|png|gif|webp)/i.test(url);
  }
}
 
/** Open a full-screen lightbox for an image */
function openImage(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
 
  const bg = document.createElement('div');
  bg.className = 'lightbox-bg';
  bg.onclick   = () => overlay.remove();
 
  const content  = document.createElement('div');
  content.className = 'lightbox-content';
 
  const closeBtn = document.createElement('button');
  closeBtn.className   = 'lightbox-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick     = () => overlay.remove();
 
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Full size image';
 
  const link = document.createElement('a');
  link.href        = url;
  link.target      = '_blank';
  link.className   = 'lightbox-open';
  link.textContent = 'Open original ↗';
 
  content.appendChild(closeBtn);
  content.appendChild(img);
  content.appendChild(link);
  overlay.appendChild(bg);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}
 
/**
 * Parse bot response text into DOM nodes.
 * Handles markdown links [caption](url) and bare image URLs.
 * Never uses innerHTML — completely XSS-safe.
 */
function renderContent(text) {
  const container   = document.createElement('div');
  const mdLinkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const lines       = text.split('\n');
 
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    mdLinkRegex.lastIndex = 0;
    let lastIndex = 0;
    let match;
 
    while ((match = mdLinkRegex.exec(line)) !== null) {
      // Plain text before this link
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
      }
 
      const caption = match[1];
      const url     = match[2].trim();
 
      if (isImageUrl(url)) {
        // Render as thumbnail
        const wrap = document.createElement('div');
        wrap.className = 'chat-image-wrap';
 
        const img = document.createElement('img');
        img.src       = url;
        img.alt       = caption;
        img.className = 'chat-image';
        img.onclick   = () => openImage(url);
        img.onerror   = () => { wrap.style.display = 'none'; };
 
        const cap = document.createElement('div');
        cap.className   = 'chat-image-caption';
        cap.textContent = caption;
 
        wrap.appendChild(img);
        wrap.appendChild(cap);
        container.appendChild(wrap);
 
      } else {
        // Render as hyperlink
        const a = document.createElement('a');
        a.href        = url;
        a.target      = '_blank';
        a.className   = 'chat-link';
        a.textContent = caption;
        container.appendChild(a);
      }
 
      lastIndex = match.index + match[0].length;
    }
 
    // Remaining text after last link
    const remaining = line.slice(lastIndex);
    if (remaining) {
      const trimmed = remaining.trim();
      if (/^https?:\/\/\S+/i.test(trimmed) && isImageUrl(trimmed)) {
        // Bare image URL — render as image
        const wrap = document.createElement('div');
        wrap.className = 'chat-image-wrap';
 
        const img = document.createElement('img');
        img.src       = trimmed;
        img.alt       = 'Image';
        img.className = 'chat-image';
        img.onclick   = () => openImage(trimmed);
        img.onerror   = () => { wrap.style.display = 'none'; };
 
        wrap.appendChild(img);
        container.appendChild(wrap);
      } else if (remaining.trim()) {
        container.appendChild(document.createTextNode(remaining));
      }
    }
 
    // Line break between lines (except after last)
    if (lineIdx < lines.length - 1) {
      container.appendChild(document.createElement('br'));
    }
  }
 
  return container;
}
 
 
/* ============================================================
   TEXT CHAT
   ============================================================ */
async function sendText() {
  const input = document.getElementById('input');
  const msg   = input.value.trim();
  if (!msg) return;
 
  input.value = '';
  autoResize(input);
  addMessage('user', msg);
  addMessage('bot', '', true);
 
  try {
    const res  = await fetch(`${BACKEND}/text`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: msg, session_id: SESSION_ID })
    });
    const data = await res.json();
    removeTyping();
    addMessage('bot', data.response || 'No response');
  } catch (e) {
    removeTyping();
    addMessage('bot', '⚠ Could not reach backend.');
  }
}
 
 
/* ============================================================
   DOCUMENT UPLOAD & Q&A
   ============================================================ */
 
/** Called when user selects a file via the file input */
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  uploadFile(file);
}
 
/** Upload file to backend, store chunks, show status */
async function uploadFile(file) {
  const status     = document.getElementById('docStatus');
  const statusIcon = document.getElementById('docStatusIcon');
  const statusText = document.getElementById('docStatusText');
 
  status.className     = 'doc-status processing';
  statusIcon.textContent = '⏳';
  statusText.textContent = `Processing ${file.name}…`;
 
  addMessage('bot', `📄 Processing document: ${file.name}…`);
 
  const formData = new FormData();
  formData.append('file', file);
 
  try {
    const res  = await fetch(`${BACKEND}/process-file`, { method: 'POST', body: formData });
    const data = await res.json();
 
    currentKey = data.key;
    documentHistory.unshift({ key: data.key, name: file.name, time: now() });
    renderDocHistory();
 
    status.className     = 'doc-status ready';
    statusIcon.textContent = '✓';
    statusText.textContent = `Ready: ${file.name}`;
 
    addMessage('bot', `✅ Document ready! Switch to Document Q&A mode and ask questions below.`);
    setMode('doc');
  } catch (e) {
    status.className     = 'doc-status error';
    statusIcon.textContent = '✗';
    statusText.textContent = 'Processing failed';
    addMessage('bot', '⚠ Document processing failed. Check your backend.');
  }
}
 
/** Drag-and-drop handlers for the upload zone */
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});
 
/** Render the uploaded document history list in the sidebar */
function renderDocHistory() {
  const container = document.getElementById('docHistory');
  container.innerHTML = '';
 
  documentHistory.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-history-item' + (doc.key === currentKey ? ' active' : '');
    item.innerHTML = `
      <span class="doc-hist-icon">📄</span>
      <div class="doc-hist-info">
        <div class="doc-hist-name">${doc.name}</div>
        <div class="doc-hist-time">${doc.time}</div>
      </div>`;
    item.onclick = () => switchDoc(doc.key, doc.name);
    container.appendChild(item);
  });
}
 
/** Switch active document context */
function switchDoc(key, name) {
  currentKey = key;
  renderDocHistory();
  addMessage('bot', `📄 Switched to: ${name}`);
  setMode('doc');
}
 
/** Ask a question about the current document */
async function ask() {
  const q = document.getElementById('question').value.trim();
  if (!q) return;
  if (!currentKey) {
    addMessage('bot', '⚠ Please upload a document first.');
    return;
  }
 
  document.getElementById('question').value = '';
  addMessage('user', q);
  addMessage('bot', '', true);
 
  try {
    const res  = await fetch(`${BACKEND}/ask-doc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key: currentKey, question: q, session_id: SESSION_ID })
    });
    const data = await res.json();
    removeTyping();
    addMessage('bot', data.response || 'No response');
  } catch (e) {
    removeTyping();
    addMessage('bot', '⚠ Failed to query document.');
  }
}
 
// Allow Enter key in doc Q&A bar
document.getElementById('question').addEventListener('keydown', e => {
  if (e.key === 'Enter') ask();
});
 
 
/* ============================================================
   VOICE — CONTINUOUS LOOP
   ============================================================ */
let recognition = null;
let isRecording  = false;
let voiceActive  = false;
let isSpeaking   = false;
 
/** Toggle voice mode on/off */
function toggleVoice() {
  voiceActive ? stopVoiceMode() : startVoiceMode();
}
 
/** Enter continuous voice mode */
function startVoiceMode(alreadyWoken = false) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    addMessage('bot', '⚠ Voice input requires Chrome or Edge.');
    return;
  }
 
  voiceActive = true;
  setMode('voice');
 
  if (!alreadyWoken) {
    addMessage('bot', '🎙️ Voice mode ON — speak anytime. Click ⏹ to stop.');
  }
 
  document.getElementById('voiceToggle').classList.add('recording');
  document.getElementById('voiceToggle').textContent = '⏹';
 
  listenOnce();
}
 
/**
 * One listen cycle:
 * mic opens → user speaks → auto-stops → transcribes → sends → speaks reply → restarts
 */
function listenOnce() {
  if (!voiceActive) return;
 
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous      = false; // auto-stops after pause
  recognition.interimResults  = true;  // live transcription
  recognition.lang            = 'en-US';
 
  let finalTranscript = '';
 
  recognition.onstart = () => {
    isRecording = true;
    document.getElementById('input').placeholder = '🎙️ Listening...';
    document.getElementById('input').value       = '';
    finalTranscript = '';
  };
 
  recognition.onresult = event => {
    let interim = '';
    finalTranscript = '';
    for (let i = 0; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    document.getElementById('input').value = finalTranscript + interim;
    autoResize(document.getElementById('input'));
  };
 
  recognition.onend = async () => {
    isRecording = false;
    const text = finalTranscript.trim();
 
    // Voice mode was stopped — clean up
    if (!voiceActive) {
      document.getElementById('input').value       = '';
      document.getElementById('input').placeholder = 'Message Friday...';
      return;
    }
 
    // No speech detected — just listen again
    if (!text) {
      document.getElementById('input').placeholder = '🎙️ Listening...';
      setTimeout(() => listenOnce(), 300);
      return;
    }
 
    // Send speech to backend
    document.getElementById('input').value       = '';
    document.getElementById('input').placeholder = '⏳ Processing...';
    autoResize(document.getElementById('input'));
 
    addMessage('user', '🎙️ ' + text);
    addMessage('bot', '', true);
 
    try {
      const res  = await fetch(`${BACKEND}/text`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, session_id: SESSION_ID })
      });
      const data = await res.json();
      removeTyping();
      const reply = data.response || 'No response';
      addMessage('bot', reply);
 
      // Speak reply → speak() auto-restarts listenOnce() when done
      if (voiceActive) speak(reply);
 
    } catch (e) {
      removeTyping();
      addMessage('bot', '⚠ Could not reach backend.');
      if (voiceActive) setTimeout(() => listenOnce(), 500);
    }
  };
 
  recognition.onerror = event => {
    if (event.error === 'no-speech') {
      // Normal — restart silently
      setTimeout(() => listenOnce(), 300);
      return;
    }
    if (event.error === 'aborted') return; // intentional stop
 
    console.error('Voice error:', event.error);
    addMessage('bot', `⚠ Voice error: ${event.error}`);
    if (voiceActive) setTimeout(() => listenOnce(), 1000);
  };
 
  recognition.start();
}
 
/** Exit voice mode */
function stopVoiceMode() {
  voiceActive = false;
  isRecording = false;
 
  window.speechSynthesis.cancel();
  isSpeaking = false;
 
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
 
  document.getElementById('voiceToggle').classList.remove('recording');
  document.getElementById('voiceToggle').textContent = '🎙️';
  document.getElementById('input').placeholder       = 'Message Friday...';
  document.getElementById('input').value             = '';
 
  addMessage('bot', '🔇 Voice mode OFF.');
  setMode('chat');
}
 
 
/* ============================================================
   TEXT-TO-SPEECH
   ============================================================ */
 
/**
 * Speak text using Web Speech Synthesis.
 * @param {string}   text
 * @param {Function} [onDoneCallback] - called when speech finishes (optional)
 */
function speak(text, onDoneCallback = null) {
  window.speechSynthesis.cancel();
 
  const utterance    = new SpeechSynthesisUtterance(text);
  utterance.rate     = 1.0;
  utterance.pitch    = 1.0;
  utterance.volume   = 1.0;
 
  // Pick best available English voice
  const voices    = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name === 'Google UK English Male')
                 || voices.find(v => v.name === 'Google US English')
                 || voices.find(v => v.name.includes('Male'))
                 || voices.find(v => v.lang === 'en-US')
                 || voices[0];
  if (preferred) utterance.voice = preferred;
 
  utterance.onstart = () => {
    isSpeaking = true;
    document.getElementById('input').placeholder = '🔊 Speaking...';
  };
 
  utterance.onend = () => {
    isSpeaking = false;
    if (onDoneCallback) {
      onDoneCallback();
    } else if (voiceActive) {
      document.getElementById('input').placeholder = '🎙️ Listening...';
      setTimeout(() => listenOnce(), 300);
    }
  };
 
  utterance.onerror = e => {
    isSpeaking = false;
    console.error('Speech error:', e);
    if (onDoneCallback) onDoneCallback();
    else if (voiceActive) setTimeout(() => listenOnce(), 300);
  };
 
  window.speechSynthesis.speak(utterance);
}
 
// Pre-load voices on browsers that load them asynchronously
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
 
 
/* ============================================================
   AUTO-ACTIVATE IF OPENED BY WAKE WORD
   Triggered by wake_word.py opening: /?wakeword=true
   ============================================================ */
window.addEventListener('load', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('wakeword') === 'true') {
    setTimeout(() => {
      addMessage('bot', '🟢 Friday activated! How can I help you?');
      speak('Friday activated! How can I help you?', () => startVoiceMode(true));
    }, 1000);
  }
});
 
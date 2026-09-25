const CLOUD_FLARE_WORKER_URL = "https://ai.bdfz.net/";

// ----- 狀態變數 -----
let currentAnalect = null;
let allChapters = [];
let groupedChapters = {};
let conversationHistory = [];
let currentInteractionType = null; // 'yang' or null
let isWaitingForAI = false;
let activeSubMenu = null;
let currentLoadingElement = null;
let conversationSessionKey = '';
let lastLearningDraftId = '';
let lastStudentOperationId = '';
let learningRecordStatusEl = null;
let learningManifest = null;
let hydratedReadProgressCache = [];
let displayCatalogue = null;
const pendingCompletionAttempts = new Map();

// ----- DOM 元素引用 -----
let chapterMenuEl, messagesEl, inputAreaEl, userInputAreaEl, userInputEl,
    sendInputBtnEl, btnYangEl, toggleMenuBtnEl, toggleDarkBtnEl,
    sidebarEl, mainHeaderEl, bookmarkBtnEl;

// ----- Constants -----
const animals = ['🐶', '🐱', '🐷', '🦊', '🐻', '🐨', '🐼', '🐰', '🐯', '🦁', '🐬', '🐳', '🦉', '🦋'];
const SITE_KEY = 'kz';
const STORAGE_KEYS = {
    READ_PROGRESS: 'lunyu_learning_completed_v1',
    BOOKMARKS: 'lunyu_bookmarks',
    DARK_MODE: 'darkMode'
};

function getIdentity() {
    return window.BdfzIdentity || null;
}

function mountIdentity() {
    getIdentity()?.mount({ siteKey: SITE_KEY });
}

async function getAuthenticatedIdentity() {
    const evidence = window.KzLearningEvidence;
    if (!evidence?.authenticatedIdentity) return null;
    return evidence.authenticatedIdentity(getIdentity());
}

function createOpaqueEventId(chapter) {
    const prefix = `kz-chapter-${chapter?.id || 'unknown'}`;
    return getIdentity()?.createSessionKey?.(prefix)
        || window.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pendingCompletion(chapter) {
    const key = `lunyu_pending_completion_v1:${learningManifest.manifestVersion}:${chapter.id}`;
    let pending = pendingCompletionAttempts.get(key);
    if (!pending) {
        try {
            const saved = JSON.parse(window.sessionStorage.getItem(key));
            if (/^[A-Za-z0-9:_-]{12,100}$/.test(saved?.eventId || '')
                && Number.isFinite(saved.notBefore) && saved.notBefore >= 0
                && saved.notBefore <= Date.now() + 86400000) pending = saved;
        } catch {}
    }
    return { key, pending };
}

async function syncCompletedChapter(chapter) {
    if (!chapter || !learningManifest || !window.KzLearningEvidence?.syncChapterCompletion) return null;
    if (!window.KzLearningEvidence.manifestItem(learningManifest, chapter)) return null;
    const recordContext = { ...learningContext(), chapterId: chapter.id, chapterTitle: chapter.title };
    const capture = captureLearningOperation('completion.sync.request', { chapterId: chapter.id }, { actor:'system', status:'pending', contentOrigin:'completion_sync' }, recordContext);
    if (capture) await capture.saved;
    const attempt = pendingCompletion(chapter);
    const key = attempt.key;
    let pending = attempt.pending;
    pending ||= { eventId: createOpaqueEventId(chapter), notBefore: 0 };
    const save = () => {
        pendingCompletionAttempts.set(key, pending);
        try { window.sessionStorage.setItem(key, JSON.stringify(pending)); } catch {}
    };
    save();
    if (pending.notBefore > Date.now()) {
        const error = new Error('閱讀進度暫未同步，請稍後重試。');
        error.status = 429;
        error.retryAfterSeconds = Math.ceil((pending.notBefore - Date.now()) / 1000);
        throw error;
    }
    try {
        const result = await window.KzLearningEvidence.syncChapterCompletion({
            identity: getIdentity(),
            manifest: learningManifest,
            chapter,
            eventId: pending.eventId,
            sourceUrl: `${window.location.origin}${window.location.pathname}`,
        });
        if (result?.status === 'synced' || result?.status === 'skipped') {
            pendingCompletionAttempts.delete(key);
            try { window.sessionStorage.removeItem(key); } catch {}
        }
        const completionResult = captureLearningOperation('completion.sync.result', { syncStatus: result?.status || 'unknown' }, { actor:'system', status:result?.status === 'synced' ? 'succeeded' : 'partial', parentOperationId:capture?.operation.operationId || '', contentOrigin:'completion_sync' }, recordContext);
        if (completionResult) await completionResult.saved.catch(() => showLearningRecordState({status:'storage_error'}));
        return result;
    } catch (error) {
        captureLearningOperation('completion.sync.failure', { httpStatus:error?.status || null, errorClass:error?.name || 'Error' }, { actor:'system', status:'failed', parentOperationId:capture?.operation.operationId || '', contentOrigin:'completion_sync' }, recordContext);
        if (error?.status === 429 && Number.isFinite(error.retryAfterSeconds)) {
            pending.notBefore = Date.now() + Math.min(86400, Math.max(1, error.retryAfterSeconds)) * 1000;
            save();
        }
        throw error;
    }
}

function showCompletionRetry(chapter, error) {
    addMessage(`${chapter.title}：${error?.status === 429 ? error.message : '閱讀進度暫未同步，請重試。'}`, 'system');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '重試同步';
    const delay = error?.status === 429 ? Math.min(86400, Math.max(1, error.retryAfterSeconds || 60)) * 1000 : 0;
    button.disabled = delay > 0;
    if (delay) setTimeout(() => { button.disabled = false; }, delay);
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await syncCompletedChapter(chapter);
            if (result?.status === 'synced') {
                markAsRead(chapter.id);
                button.remove();
                addMessage('本章閱讀進度已保存。', 'system');
            } else if (result?.status === 'partial') {
                markAsRead(chapter.id);
                button.disabled = false;
                addMessage('閱讀完成已保存，用戶中心尚未同步完成，請重試。', 'system');
            } else {
                button.disabled = false;
                addMessage('請先登入，再重試同步。', 'system');
            }
        } catch (retryError) {
            button.remove();
            showCompletionRetry(chapter, retryError);
        }
    });
    messagesEl.appendChild(button);
}

function restoreCompletionRetry(chapter) {
    if (!learningManifest || !window.KzLearningEvidence?.manifestItem(learningManifest, chapter)) return;
    const { pending } = pendingCompletion(chapter);
    if (!pending) return;
    const seconds = Math.ceil((pending.notBefore - Date.now()) / 1000);
    showCompletionRetry(chapter, seconds > 0
        ? { status: 429, retryAfterSeconds: seconds, message: '閱讀進度暫未同步，請稍後重試。' }
        : null);
}

async function trackDialogue(chapter, message) {
    if (!chapter || !message) return;
    const identity = await getAuthenticatedIdentity();
    if (!identity) return;
    identity.syncProgress({
        siteKey: SITE_KEY,
        itemKey: `dialogue-${chapter.id}`,
        itemTitle: `${chapter.title || '論語章節'} 对话`,
        itemGroup: '问答',
        itemType: 'discussion',
        state: 'in_progress',
        progressPercent: 60,
        meta: {
            source: 'lunyu',
            evidenceRole: 'journey_only',
            result: 'discussion',
            chapterId: chapter.id,
            messageLength: String(message).length,
        },
    }).catch(() => {});
}

function learningContext() {
    return { captureScope: window.KzLearningRecords?.scope || null, sessionKey: conversationSessionKey, chapterId: currentAnalect?.id || 'not-selected', chapterTitle: currentAnalect?.title || '', manifestVersion: learningManifest ? `${learningManifest.manifestVersion}:${learningManifest.sourceSha256 || 'content-digest-unavailable'}` : 'source-version-unavailable', interactionType: currentInteractionType || '' };
}

function captureLearningOperation(action, content, options = {}, context = learningContext()) {
    const service = window.KzLearningRecords;
    if (!service || !context.sessionKey) return null;
    const operation = service.build(action, content, context, options);
    // A rejection is visible through recorder state; never send raw content to console.
    const saved = service.record(operation);
    saved.catch(() => {});
    return { operation, saved };
}

function showLearningRecordState(state) {
    if (!learningRecordStatusEl) return;
    const labels = { unattributed: '記錄已保存在此裝置；帳號未確認時的內容不會自動歸屬', saved: '學習記錄已保存', saved_locally: '學習記錄已保存在本機，等待同步', pending: '學習記錄等待同步', offline: '離線中，學習記錄保存在本機', storage_error: '學習記錄暫未保存，請保留此頁並重試', needs_attention: '學習記錄暫未同步，請保留此頁並重試' };
    learningRecordStatusEl.textContent = state.code === 'LEARNING_LOGIN_REQUIRED' ? '請登入以保存完整學習記錄' : (labels[state.status] || '');
}

function resetConversationSession() {
    lastLearningDraftId = ''; lastStudentOperationId = '';
    conversationSessionKey = getIdentity()?.createSessionKey?.(`${SITE_KEY}-chat`) || `${SITE_KEY}-chat-${Date.now().toString(36)}`;
}

async function syncConversationArchive(reason = 'update') {
    if (!conversationHistory.length) return;
    if (!conversationSessionKey) resetConversationSession();
    const captureScope=window.KzLearningRecords?.scope;
    if(!captureScope || conversationHistory.some(message=>message.captureScope!==captureScope))return;
    const chapter = currentAnalect;
    const snapshot = {
        siteKey: SITE_KEY, sessionKey: conversationSessionKey,
        title: (chapter?.title || '論語').slice(0, 80),
        summary: conversationHistory[conversationHistory.length - 1]?.content?.slice(0, 120) || '論語對話',
        sourceUrl: `${window.location.origin}${window.location.pathname}`,
        messages: conversationHistory.map(message => ({ id: message.id, role: message.role === 'user' ? 'user' : 'assistant', content: message.content, createdAt: message.createdAt })),
        contentFormat: 'kz-conversation-v2',
        meta: { evidenceRole: 'journey_only', reason, chapterId: chapter?.id || '', interactionType: currentInteractionType || '' },
    };
    const identity = await getAuthenticatedIdentity();
    if (!identity || window.KzLearningRecords?.scope!==captureScope) return;
    // Full-fidelity operations are saved independently; this remains a legacy display projection.
    return identity.recordConversation(snapshot).catch(() => showLearningRecordState({status:'pending'}));
}


/* ========== 初始化 ========== */
document.addEventListener("DOMContentLoaded", () => {
    mountIdentity();
    resetConversationSession();
    applyDarkModePreference();
    initializeDOMElements();
    bindEventListeners();
    if (window.KzLearningRecords) {
        learningRecordStatusEl = document.getElementById('learning-record-status');
        window.KzLearningRecords.onState(showLearningRecordState);
        window.KzLearningRecords.prepare().catch(() => {});
        document.getElementById('learning-record-retry')?.addEventListener('click', () => window.KzLearningRecords.retry().catch(() => {}));
    }
    loadDialogues();
    updateProgressDisplay();
});

function initializeDOMElements() {
    chapterMenuEl = document.getElementById("chapter-menu");
    messagesEl = document.getElementById("messages");
    inputAreaEl = document.getElementById("input-area");
    userInputAreaEl = document.getElementById("user-input-area");
    userInputEl = document.getElementById("user-input");
    sendInputBtnEl = document.getElementById("send-input-btn");
    btnYangEl = document.getElementById("btn-yang");
    toggleMenuBtnEl = document.getElementById("toggle-menu-btn");
    toggleDarkBtnEl = document.getElementById("toggle-dark-btn");
    sidebarEl = document.getElementById("sidebar");
    mainHeaderEl = document.querySelector("#main-content > header");
    bookmarkBtnEl = document.getElementById("bookmark-btn");
}

function bindEventListeners() {
    if (toggleMenuBtnEl) toggleMenuBtnEl.addEventListener("click", toggleMenu);
    if (toggleDarkBtnEl) toggleDarkBtnEl.addEventListener("click", toggleDarkMode);
    if (userInputEl) {
        userInputEl.addEventListener('input', event => {
            const captured = captureLearningOperation('draft.edit', { text: userInputEl.value, inputType: event.inputType || '', isComposing: Boolean(event.isComposing) }, { revisesOperationId: lastLearningDraftId });
            if (captured) lastLearningDraftId = captured.operation.operationId;
        });
        userInputEl.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleUserInput();
            }
        });
    }
}

/* ========== 數據載入與目錄生成 ========== */
function buildDisplayCatalogue(rows, manifest = null) {
    const bookNames = ['學而', '為政', '八佾', '里仁', '公冶長', '雍也', '述而', '泰伯', '子罕', '鄉黨', '先進', '顏淵', '子路', '憲問', '衛靈公', '季氏', '陽貨', '微子', '子張', '堯曰'];
    const bookCounts = [16, 24, 26, 26, 28, 30, 38, 21, 31, 27, 26, 24, 30, 44, 42, 14, 26, 11, 25, 3];
    const keyHash = '79b9c5647108bc9be8fea0f23e9585cff24e0083e70cadbaf52629e54fdfe6ca';
    if (!Array.isArray(rows) || rows.length !== 541) throw new Error('expected 541 legacy dialogue records');
    if (manifest && (manifest.schemaVersion !== 1 || manifest.siteKey !== 'kz'
        || manifest.itemCount !== 541 || manifest.completionThreshold !== 163
        || manifest.resourceKeySha256 !== keyHash || manifest.manifestVersion !== `kz-${keyHash.slice(0, 16)}`
        || !Array.isArray(manifest.items) || manifest.items.length !== 541)) {
        throw new Error('learning manifest identity mismatch');
    }
    const firstIds = new Map();
    const parsed = rows.map((row, index) => {
        const id = row?.id;
        if (!Number.isInteger(id) || id !== index + 1) throw new Error('dialogue ID/order mismatch');
        const match = typeof row.title === 'string' && row.title.match(/^(\S+) ([1-9]\d*)\.([1-9]\d*)$/);
        const major = Number(match?.[2]), minor = Number(match?.[3]);
        if (!match || match[1] !== bookNames[major - 1] || minor > bookCounts[major - 1]) {
            throw new Error('noncanonical dialogue title');
        }
        if (typeof row.text !== 'string' || !row.text.trim()
            || typeof row.translation !== 'string' || !row.translation.trim()
            || typeof row.annotations !== 'string') throw new Error('invalid dialogue learning content');
        const expectedAlias = id >= 268 && id <= 270 ? id - 3 : id >= 297 && id <= 322 ? id - 26 : null;
        if (expectedAlias === null ? Object.hasOwn(row, 'displayAliasOf') : row.displayAliasOf !== expectedAlias) {
            throw new Error('display alias ledger mismatch');
        }
        const coordinate = `${major}.${minor}`;
        if (!firstIds.has(coordinate)) firstIds.set(coordinate, id);
        if (manifest) {
            const item = manifest.items[index];
            if (item?.resourceKey !== `chapter-${id}` || item.chapterId !== String(id)
                || item.itemType !== 'chapter' || item.itemTitle !== row.title
                || item.itemGroup !== bookNames[major - 1] || item.major !== major || item.minor !== minor) {
                throw new Error('dialogue/manifest item mismatch');
            }
        }
        return { id, title: row.title, bookName: bookNames[major - 1], major, minor };
    });
    const chapters = [], displayIds = new Map(), coordinates = new Set();
    const actualCounts = Array(20).fill(0);
    for (const entry of parsed) {
        const row = rows[entry.id - 1], targetId = row.displayAliasOf ?? row.id;
        const coordinate = `${entry.major}.${entry.minor}`;
        if (Object.hasOwn(row, 'displayAliasOf')) {
            const target = rows[targetId - 1];
            if (!target || Object.hasOwn(target, 'displayAliasOf') || firstIds.get(coordinate) !== targetId
                || ['title', 'text', 'translation', 'annotations'].some(field => row[field] !== target[field])) {
                throw new Error('display alias content/target mismatch');
            }
        } else {
            if (coordinates.has(coordinate)) throw new Error('undeclared duplicate display chapter');
            coordinates.add(coordinate);
            actualCounts[entry.major - 1]++;
            chapters.push({ ...row, major: entry.major, minor: entry.minor });
        }
        displayIds.set(String(row.id), String(targetId));
    }
    if (chapters.length !== 512 || actualCounts.some((count, index) => count !== bookCounts[index])) {
        throw new Error('display chapter coverage mismatch');
    }
    chapters.sort((a, b) => a.major - b.major || a.minor - b.minor);
    return { chapters, displayIds, parsed };
}

function loadDialogues() {
    // 顯示載入狀態
    if (messagesEl) {
        messagesEl.innerHTML = '<div class="message-container system"><p>正在載入論語數據...</p></div>';
    }

    return Promise.all([
        fetch("data/dialogues.json", { cache: 'no-store' }).then(res => { if (!res.ok) throw new Error(`dialogues HTTP ${res.status}`); return res.json(); }),
        fetch("data/learning-manifest.json", { cache: 'no-store' }).then(res => { if (!res.ok) throw new Error(`manifest HTTP ${res.status}`); return res.json(); }),
    ])
        .then(([data, manifest]) => {
            if (!Array.isArray(data) || data.length === 0) throw new Error("dialogues.json empty/invalid");
            if (manifest?.schemaVersion !== 1 || manifest?.siteKey !== SITE_KEY || manifest?.itemCount !== data.length) {
                throw new Error("learning-manifest.json mismatch");
            }
            learningManifest = manifest;
            allChapters = data;
            groupChapters();
            renderChapterMenu();
            displayInitialRandomAnalect();
            if (btnYangEl) btnYangEl.disabled = true;
            updateProgressDisplay();
            // 菜單渲染完成後，從用戶系統拉一次遠端進度並合併，失敗靜默降級
            hydrateReadProgressFromIdentity();
        })
        .catch(err => {
            console.error("Init Error:", err);
            if (messagesEl) {
                messagesEl.innerHTML = '';
                addMessage(`錯誤：無法載入論語數據。\n(${err.message})`, 'system', true);
            }
            disableInteractionButtons(true);
        });
}

function displayInitialRandomAnalect() {
    const chapters = displayCatalogue?.chapters || [];
    if (chapters.length === 0) return;
    const randomIndex = Math.floor(Math.random() * chapters.length);
    const randomChapter = chapters[randomIndex];
    if (!randomChapter) return;

    const title = randomChapter.title;
    const text = randomChapter.text;
    const translation = randomChapter.translation || "（暫無譯文）";
    const annotations = randomChapter.annotations || "（暫無注釋）";
    captureLearningOperation('chapter.exposure', { text, translation, annotations }, { actor:'system', contentOrigin:'source_text' }, { ...learningContext(), chapterId:randomChapter.id, chapterTitle:title });

    if (messagesEl) {
        messagesEl.innerHTML = ''; // Clear first
        addMessage(`**隨機章節：${title}**\n\n${text}\n\n**譯文：**\n${translation}\n\n**注釋：**\n${annotations}`, 'initial');
        addMessage("或者，請你自己從左側目錄選擇章節研讀。", 'system');
    }
}

function groupChapters() {
    displayCatalogue = buildDisplayCatalogue(allChapters, learningManifest);
    groupedChapters = {};
    displayCatalogue.chapters.forEach(item => {
        if (!groupedChapters[item.major]) groupedChapters[item.major] = { name: item.title.split(' ')[0], chapters: [] };
        groupedChapters[item.major].chapters.push(item);
    });
}

function renderChapterMenu() {
    if (!chapterMenuEl) return;
    chapterMenuEl.innerHTML = "";
    const sortedMajors = Object.keys(groupedChapters).map(Number).sort((a, b) => a - b);
    sortedMajors.forEach(major => {
        const chapterData = groupedChapters[major];
        const container = document.createElement('div'); container.className = 'major-chapter-container';
        const btn = document.createElement("button");
        btn.textContent = chapterData.name ? `${chapterData.name} (第 ${major} 章)` : `第 ${major} 章`;
        btn.classList.add('ghibli-button', 'major-chapter-btn'); btn.dataset.major = major;
        btn.onclick = (e) => { e.preventDefault(); toggleSubChapterMenu(major, container, btn); };
        container.appendChild(btn); chapterMenuEl.appendChild(container);
    });
}

function toggleSubChapterMenu(major, container, button) {
    if (activeSubMenu && activeSubMenu.container !== container) {
        if (activeSubMenu.container.contains(activeSubMenu.element)) { activeSubMenu.container.removeChild(activeSubMenu.element); }
        activeSubMenu.button.classList.remove('active'); activeSubMenu = null;
    }
    const existingSubMenu = container.querySelector('.sub-menu-container');
    if (existingSubMenu) { container.removeChild(existingSubMenu); button.classList.remove('active'); activeSubMenu = null; }
    else { renderSubChapterMenu(major, container); button.classList.add('active'); }
}

function renderSubChapterMenu(major, container) {
    const subChapters = groupedChapters[major]?.chapters;
    if (!subChapters || subChapters.length === 0) return;
    const subMenuContainer = document.createElement("div"); subMenuContainer.className = "sub-menu-container";
    subChapters.forEach(item => {
        const a = document.createElement("a"); a.href = "#"; a.textContent = `${item.major}.${item.minor}`;
        a.classList.add('ghibli-button', 'sub-chapter-link');
        a.dataset.chapterId = String(item.id);
        a.onclick = (e) => {
            e.preventDefault(); displayChapter(item.id);
            if (window.innerWidth <= 768 && chapterMenuEl && chapterMenuEl.style.display !== 'none') { toggleMenu(); }
        };
        subMenuContainer.appendChild(a);
    });
    container.appendChild(subMenuContainer);
    activeSubMenu = { element: subMenuContainer, container: container, button: container.querySelector('.major-chapter-btn') };
    updateChapterMenuReadStatus();
}


// 顯示指定 ID 的論語內容到對話框
function displayChapter(id) {
    const chapter = allChapters.find(ch => ch.id == id);
    if (!chapter) {
        console.error("Chapter not found:", id);
        addMessage(`錯誤：找不到 ID 為 ${id} 的章節。`, 'system', true);
        return;
    }
    currentAnalect = chapter;

    resetInteractionState(); // Clear messages, history, reset button states
    captureLearningOperation('chapter.open', { text: chapter.text, translationAvailable: Boolean(chapter.translation), annotationsAvailable: Boolean(chapter.annotations) }, { contentOrigin: 'source_text' });

    // Add the chapter title/text with a specific class for styling
    const chapterMessage = addMessage(`**${chapter.title}**\n\n${chapter.text}`, 'system');
    if (chapterMessage) {
        chapterMessage.classList.add('chapter-display'); // Add class
    }

    // Enable the Yang button and show its area
    if (btnYangEl) btnYangEl.disabled = false;
    if (inputAreaEl) inputAreaEl.style.display = 'flex';

    restoreCompletionRetry(chapter);
}

// 重置對話狀態
function resetInteractionState() {
    conversationHistory = []; currentInteractionType = null; isWaitingForAI = false; resetConversationSession();
    removeLoadingMessage();
    if (messagesEl) messagesEl.innerHTML = ""; // Always clear messages
    if (userInputAreaEl) userInputAreaEl.style.display = "none";
    if (userInputEl) userInputEl.value = "";
    if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」";
    if (inputAreaEl) inputAreaEl.style.display = 'flex';
    if (btnYangEl) btnYangEl.disabled = !currentAnalect;
    if (sendInputBtnEl) sendInputBtnEl.disabled = false;
}

// Enable/Disable Buttons
function enableInteractionButtons() {
    if (currentAnalect && btnYangEl) btnYangEl.disabled = false;
    if (sendInputBtnEl) sendInputBtnEl.disabled = false;
    isWaitingForAI = false;
}
function disableInteractionButtons(permanently = false) {
    if (btnYangEl) btnYangEl.disabled = true;
    if (sendInputBtnEl) sendInputBtnEl.disabled = true;
    if (!permanently) { isWaitingForAI = true; }
}

/* ========== AI 互動相關函式 ========== */

// Format Text Helper
// Escape HTML to prevent injection
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatMessageText(text) {
    if (!text) return "";
    // Sanitize HTML first
    text = escapeHtml(text);
    // Bold markdown-like syntax
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Replace double newlines with paragraph breaks, single newlines with <br>
    const paragraphs = text.split(/\n\s*\n+/);
    return paragraphs.map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('');
}

// Add Message Helper
function addMessage(messageText, sender = "system", isError = false, recordOptions = {}) {
    if (!messagesEl) return;
    const messageContainer = document.createElement("div");
    messageContainer.classList.add("message-container", sender);
    if (isError) messageContainer.style.color = 'red'; // Simple error indication

    if (sender === 'loading') {
        messageContainer.classList.add('loading-message');
        messageContainer.innerHTML = `<p>${messageText}</p>`;
        currentLoadingElement = messageContainer; // Track loading message
    } else if (sender === 'ai' || sender === 'confucius' || sender === 'user') {
        const messageContentId = `message-content-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const contentSpan = document.createElement('span');
        contentSpan.id = messageContentId;
        contentSpan.innerHTML = formatMessageText(messageText);

        messageContainer.innerHTML = ''; // Clear existing content
        messageContainer.appendChild(contentSpan);

        const copyButton = document.createElement('button');
        copyButton.className = 'copy-btn';
        copyButton.dataset.target = messageContentId;
        copyButton.title = '複製';
        copyButton.textContent = '複製';
        messageContainer.appendChild(copyButton);
    }
    else {
        // Apply strong tag styling within the formatted HTML
        messageContainer.innerHTML = formatMessageText(messageText);
    }

    messagesEl.appendChild(messageContainer);
    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Add to history only if it's user or AI/Confucius response
    // Make sure to push the original messageText, not the HTML content
    if (sender === 'user' || sender === 'ai' || sender === 'confucius') {
        const message = { captureScope:Object.prototype.hasOwnProperty.call(recordOptions,'captureScope')?recordOptions.captureScope:window.KzLearningRecords?.scope||null, id: recordOptions.operationId || window.KzLearningRecords?.id?.() || createOpaqueEventId(currentAnalect), role: sender, content: messageText, createdAt: recordOptions.occurredAt || new Date().toISOString() };
        conversationHistory.push(message);
        if (!recordOptions.alreadyRecorded) {
            const captured = captureLearningOperation(sender === 'user' ? 'answer.submit' : recordOptions.action || 'assistant.reply', { text: messageText }, { operationId: message.id, occurredAt: message.createdAt, actor: sender === 'user' ? 'student' : recordOptions.contentOrigin === 'source_text' ? 'system' : 'assistant', status:'succeeded', parentOperationId: sender === 'user' ? lastLearningDraftId : lastStudentOperationId, contentOrigin: recordOptions.contentOrigin || (sender === 'user' ? 'student' : 'ai_reply') });
            if (sender === 'user' && captured) lastStudentOperationId = captured.operation.operationId;
        }
        syncConversationArchive(sender === 'user' ? 'user-message' : 'assistant-message');
    }
    return messageContainer;
}


// Remove Loading Message Helper
function removeLoadingMessage() {
    if (currentLoadingElement && messagesEl && messagesEl.contains(currentLoadingElement)) {
        messagesEl.removeChild(currentLoadingElement);
    }
    currentLoadingElement = null;
}

// Format History for AI Helper
function formatHistoryForAI(history) {
    return history.map(msg => {
        let roleName = msg.role;
        if (roleName === 'confucius' || roleName === 'ai') roleName = '孔子';
        else if (roleName === 'user') roleName = '用戶';
        else return null; // Exclude system, initial, loading messages
        return `${roleName}：\n${msg.content}`;
    }).filter(Boolean).join('\n\n'); // Filter out nulls and join
}


// Ask Gemini Helper with Retry
async function askGemini(prompt, callback, retryCount = 0, requestContext = learningContext()) {
    const MAX_RETRIES = 2;
    if (requestContext.sessionKey !== conversationSessionKey) return;
    requestContext = { ...requestContext, parentOperationId: requestContext.parentOperationId ?? lastStudentOperationId };

    if (isWaitingForAI && retryCount === 0) {
        console.warn("AI processing...");
        return;
    }
    if (retryCount === 0) disableInteractionButtons();

    const attempt = captureLearningOperation('ai.request', { prompt, attemptNumber: retryCount + 1 }, { actor:'system', status:'pending', parentOperationId:requestContext.parentOperationId, contentOrigin:'request_context' }, requestContext);
    // Persist the exact attempt before any provider request. Recording failures must
    // never enter the provider retry path (which could issue an unrecorded request).
    try {
        if (!attempt) throw new Error('LEARNING_RECORDER_NOT_READY');
        await attempt.saved;
    } catch {
        if (requestContext.sessionKey === conversationSessionKey) {
            removeLoadingMessage();
            enableInteractionButtons();
            callback('學習記錄尚未可靠保存，請保留此頁，登入或恢復記錄服務後再試。', true);
        }
        return;
    }
    if (requestContext.sessionKey !== conversationSessionKey) return;
    return fetch(CLOUD_FLARE_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt })
    })
        .then(response => {
            if (!response.ok) throw Object.assign(new Error(`AI請求失敗 (${response.status})`), {status:response.status});
            return response.json();
        })
        .then(async data => {
            const reply = captureLearningOperation('assistant.reply', { text: data.answer || '' }, { actor:'assistant', status:typeof data.answer === 'string' && data.answer ? 'succeeded' : 'failed', parentOperationId:attempt?.operation.operationId || '', contentOrigin:'ai_reply', assessment:{ reportedModel: typeof data.model === 'string' ? data.model : null, modelProvenance: typeof data.model === 'string' ? 'response_declared' : 'not_reported' } }, requestContext);
            // A storage error must not retry the provider or discard its completed reply.
            try { if (!reply) throw new Error('LEARNING_RECORDER_NOT_READY'); await reply.saved; }
            catch { showLearningRecordState({status:'storage_error'}); }
            if (requestContext.sessionKey !== conversationSessionKey) return;
            removeLoadingMessage();
            enableInteractionButtons();
            callback(data.answer || "AI 未能提供有效回答。", !data.answer, { alreadyRecorded:true, captureScope:requestContext.captureScope, operationId:reply?.operation.operationId, occurredAt:reply?.operation.occurredAt });
        })
        .catch(error => {
            captureLearningOperation('ai.failure', { errorClass:error.name || 'Error', httpStatus:error.status || null, attemptNumber:retryCount + 1 }, { actor:'system', status:'failed', parentOperationId:attempt?.operation.operationId || '', contentOrigin:'transport_result' }, requestContext);
            if (requestContext.sessionKey !== conversationSessionKey) return;

            // 重試機制
            if (retryCount < MAX_RETRIES && !error.message.includes("429")) {
                console.log(`Retrying... attempt ${retryCount + 1}`);
                setTimeout(() => {
                    askGemini(prompt, callback, retryCount + 1, requestContext);
                }, 1000 * (retryCount + 1)); // 指數退避
                return;
            }

            removeLoadingMessage();
            enableInteractionButtons();

            // 更友好的錯誤訊息
            let displayError = `唉，思緒略有阻塞，未能回應。`;
            if (error.message.includes("429")) displayError += " (似乎請求過於頻繁，請稍後再試)";
            else if (error.message.includes("502") || error.message.includes("503")) displayError += " (後端服務暫時無法連接)";
            else if (error.message.includes("network") || error.message.includes("Failed to fetch")) displayError += " (網絡連接問題，請檢查網絡)";
            else displayError += ` (${error.message})`;

            callback(displayError, true);
        });
}

// AI 導師指令：避免角色扮演誘發文言腔，優先保證可讀性與語義準確。
const confuciusPersonaInstruction = "你是 AI论语的现代语文阅读导师，陪读者一起研读《论语》。不要扮演孔子本人，也不要模拟古人口吻。请一律用现代白话文回答，语言要平实、清楚、准确，让今天的中学生一读就懂：禁止使用文言或半文半白的腔调，避免堆砌生僻典故，避免为了仿古而产生歧义或误读。可以保持温和、耐心、循循善诱的老师风格，亲切地称呼提问者为“你”。讲解要立足《论语》原文和杨伯峻译注，并可吸收历代注疏（如集解、正义、集注等）的可靠观点，但都要用今天的话把意思和道理说明白。先讲结论，再分点展开；遇到不确定或多种解释时要明确说明，不要编造。篇幅适中，不啰嗦。请使用简体中文。";


/* ========== 按鈕點擊處理 ========== */

// Handle Yang Annotation Click
function handleYangAnnotationClick() {
    if (!currentAnalect || isWaitingForAI) return;

    // Clear history, set type, KEEP initial chapter message
    conversationHistory = []; currentInteractionType = 'yang';
    const firstMessage = messagesEl.querySelector('.message-container.chapter-display');
    messagesEl.innerHTML = '';
    if (firstMessage) messagesEl.appendChild(firstMessage);

    const translation = currentAnalect.translation || "（暫無譯文）";
    const annotations = currentAnalect.annotations || "（暫無注釋）";

    // 1. Add translation and annotations
    addMessage(`**譯文**\n${translation}`, 'confucius', false, { contentOrigin:'source_text', action:'translation.reveal' });
    addMessage(`**注釋**\n${annotations}`, 'confucius', false, { contentOrigin:'source_text', action:'annotations.reveal' });

    // 顯式查看譯文與注釋才是本產品的學習完成動作；選章、導航與自動隨機展示均不計完成。
    const revealedChapter = currentAnalect;
    syncCompletedChapter(revealedChapter)
        .then((result) => {
            if (result?.status === 'synced' || result?.status === 'partial') markAsRead(revealedChapter.id);
            if (result?.status === 'partial') showCompletionRetry(revealedChapter, null);
        })
        .catch((error) => showCompletionRetry(revealedChapter, error));

    // 2. ADD specific loading message
    addMessage("Gemini正在和你一起分析這則內容⋯耐個心吧 🐶⋯", 'loading');

    // 3. Build Prompt
    const prompt = `${confuciusPersonaInstruction}\n\n本章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文：${translation}\n註疏：${annotations}\n\n请结合《论语》全文思想和历代注疏，用现代白话把这一章的意思和道理讲清楚、讲透彻，帮助读者真正读懂。`;

    // 4. Call AI
    askGemini(prompt, (aiAnswer, isError, recordOptions) => {
        // Loading message removed inside askGemini
        if (!isError) {
            addMessage(aiAnswer, 'confucius', false, recordOptions);
            // 5. Hide button area, show input area
            if (inputAreaEl) inputAreaEl.style.display = "none";
            if (userInputAreaEl) userInputAreaEl.style.display = "flex";
            if (userInputEl) userInputEl.focus();
        } else {
            addMessage(aiAnswer, 'system', true);
            resetInteractionState(); // Reset on initial error
            // Re-add chapter text if reset happened
            if (currentAnalect) {
                const chapterMessage = addMessage(`**${currentAnalect.title}**\n\n${currentAnalect.text}`, 'system');
                if (chapterMessage) chapterMessage.classList.add('chapter-display');
            }
        }
    });
}

// Handle User Input
function handleUserInput() {
    if (!userInputEl || isWaitingForAI) return;
    const userText = userInputEl.value.trim();
    if (!userText) return;
    if (!currentInteractionType) { console.error("Interaction type not set!"); return; }

    // 1. Add user message
    addMessage(userText, 'user');
    userInputEl.value = "";
    trackDialogue(currentAnalect, userText);

    // 2. ADD specific animal loading message
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    addMessage(`Gemini正在和你一起分析這則內容⋯耐個心吧 ${randomAnimal}⋯`, 'loading');

    // 3. Build Prompt
    const historyString = formatHistoryForAI(conversationHistory); // History now includes user/ai msgs
    let contextInfo = `當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文與注釋已閱。`;
    const prompt = `${confuciusPersonaInstruction}\n\n${contextInfo}\n\n--- 對話歷史 ---\n${historyString}\n\n--- 请针对用户最新的提问继续作答，保持现代白话、清楚准确，不要改成文言腔 ---`;

    // 4. Call AI
    askGemini(prompt, (aiAnswer, isError, recordOptions) => {
        // Loading message removed inside askGemini
        addMessage(aiAnswer, isError ? 'system' : 'confucius', isError, recordOptions);
        if (userInputEl && !isError) userInputEl.focus();
    });
}


/* ========== 其他功能 ========== */

// Toggle Menu Visibility
function toggleMenu() {
    if (!chapterMenuEl || !toggleMenuBtnEl) return;
    const isHidden = chapterMenuEl.style.display === "none";
    chapterMenuEl.style.display = isHidden ? "flex" : "none"; // Use flex display
    toggleMenuBtnEl.textContent = isHidden ? "隱藏目錄" : "顯示目錄";
    // 更新 aria-expanded 屬性
    toggleMenuBtnEl.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    // Close any open sub-menu when hiding the main menu
    if (!isHidden && activeSubMenu) {
        if (activeSubMenu.container.contains(activeSubMenu.element)) {
            activeSubMenu.container.removeChild(activeSubMenu.element);
        }
        activeSubMenu.button.classList.remove('active');
        activeSubMenu = null;
    }
}

// Toggle Dark Mode
function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(STORAGE_KEYS.DARK_MODE, document.body.classList.contains("dark-mode") ? "enabled" : "disabled");
}

// Apply Dark Mode Preference on Load
function applyDarkModePreference() {
    if (localStorage.getItem(STORAGE_KEYS.DARK_MODE) === "enabled") {
        document.body.classList.add("dark-mode");
    }
}

/* ========== 進度記錄功能 ========== */

// 獲取已讀章節列表
function getReadProgress() {
    try {
        const progress = localStorage.getItem(STORAGE_KEYS.READ_PROGRESS);
        const parsed = progress ? JSON.parse(progress) : [];
        const localIds = Array.isArray(parsed) ? parsed.map(id => String(id)) : [];
        return Array.from(new Set([...localIds, ...hydratedReadProgressCache]));
    } catch (e) {
        console.error("Error reading progress:", e);
        return hydratedReadProgressCache.slice();
    }
}

// 標記章節為已讀
function markAsRead(chapterId) {
    try {
        const progress = getReadProgress();
        const normalizedId = String(chapterId);
        if (!progress.includes(normalizedId)) {
            progress.push(normalizedId);
            localStorage.setItem(STORAGE_KEYS.READ_PROGRESS, JSON.stringify(progress));
            updateProgressDisplay();
            updateChapterMenuReadStatus();
        }
    } catch (e) {
        console.error("Error saving progress:", e);
    }
}

// 更新進度顯示
function projectDisplayChapterIds(rawIds) {
    if (!displayCatalogue || !Array.isArray(rawIds)) return [];
    return Array.from(new Set(rawIds.map(id => {
        if (typeof id !== 'number' && typeof id !== 'string') return null;
        return displayCatalogue.displayIds.get(String(id)) || null;
    }).filter(Boolean)));
}

function updateProgressDisplay() {
    const progress = projectDisplayChapterIds(getReadProgress());
    const total = displayCatalogue?.chapters.length || 0;
    const readCount = progress.length;

    // 更新頁面標題顯示進度
    const baseTitle = "AI論語";
    document.title = readCount > 0 && total > 0 ? `${baseTitle} (已讀 ${readCount}/${total})` : baseTitle;
}

// 更新目錄中已讀狀態
function updateChapterMenuReadStatus() {
    const progress = new Set(projectDisplayChapterIds(getReadProgress()));
    const inProgress = new Set(projectDisplayChapterIds(getInProgressChapters()));
    const subLinks = document.querySelectorAll('.sub-chapter-link');
    subLinks.forEach(link => {
        const chapterId = displayCatalogue?.displayIds.get(link.dataset.chapterId);
        if (!chapterId) {
            link.classList.remove('read', 'reading');
            return;
        }
        if (progress.has(chapterId)) {
            link.classList.add('read');
            link.classList.remove('reading');
        } else if (inProgress.has(chapterId)) {
            link.classList.add('reading');
            link.classList.remove('read');
        } else {
            link.classList.remove('read');
            link.classList.remove('reading');
        }
    });
}

// 進行中章節（僅記憶體緩存，server 為 source of truth）
let inProgressChapterCache = [];
function getInProgressChapters() {
    return inProgressChapterCache.slice();
}

// 從 BdfzIdentity（用戶系統）拉取已同步的閱讀進度，
// 與本地 localStorage 合併。server 是權威 source，本地作為離線 fallback。
// 不會破壞原有 syncProgress 寫入鏈路；僅額外做一次 GET 讀取。
async function hydrateReadProgressFromIdentity() {
    const identity = await getAuthenticatedIdentity();
    if (!identity || typeof identity.api !== 'function') return;
    try {
        const payload = await identity.api(`/api/progress?site=${encodeURIComponent(SITE_KEY)}`);
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!items.length) { updateChapterMenuReadStatus(); return; }

        const localDone = new Set(getReadProgress());
        const serverDone = [];
        const serverInProgress = [];

        const manifestKeys = new Set((learningManifest?.items || []).map(item => item.resourceKey));
        items.forEach(item => {
            const key = String(item?.itemKey || '');
            const meta = item?.meta && typeof item.meta === 'object' && !Array.isArray(item.meta) ? item.meta : {};
            if (item?.siteKey !== SITE_KEY || item?.itemType !== 'chapter'
                || !manifestKeys.has(key)
                || meta.evidenceSchema !== 'kz-learning-evidence-v1'
                || meta.manifestVersion !== learningManifest?.manifestVersion
                || meta.resourceKeySha256 !== learningManifest?.resourceKeySha256
                || meta.resourceKey !== key
                || meta.completionKind !== 'annotation_revealed'
                || meta.result !== 'completed') return;
            const chapterId = key.slice('chapter-'.length);
            // Current User Center listProgress returns the normalized percentage in meta.
            const progressPercent = meta.progressPercent ?? item.progressPercent;
            if (['done', 'completed'].includes(String(item.state || '').toLowerCase())
                && Number.isFinite(progressPercent) && progressPercent === 100) {
                serverDone.push(chapterId);
            }
        });

        // 合併：server done ∪ local done
        // Preserve only validated remote IDs in memory when localStorage is unavailable.
        hydratedReadProgressCache = Array.from(new Set(serverDone));
        const merged = Array.from(new Set([...localDone, ...serverDone]));
        try {
            localStorage.setItem(STORAGE_KEYS.READ_PROGRESS, JSON.stringify(merged));
        } catch (e) { /* quota or private mode */ }

        inProgressChapterCache = serverInProgress.filter(id => !merged.includes(id));

        updateProgressDisplay();
        updateChapterMenuReadStatus();
    } catch (e) {
        // 未登入 / 離線 / API 異常都靜默降級到本地模式
        console.debug('[lunyu] hydrateReadProgressFromIdentity skipped:', e?.message || e);
        updateChapterMenuReadStatus();
    }
}

/* ========== 書籤功能 ========== */

// 獲取書籤列表
function getBookmarks() {
    try {
        const bookmarks = localStorage.getItem(STORAGE_KEYS.BOOKMARKS);
        return bookmarks ? JSON.parse(bookmarks) : [];
    } catch (e) {
        console.error("Error reading bookmarks:", e);
        return [];
    }
}

// 切換書籤狀態
function toggleBookmark(chapterId) {
    try {
        const bookmarks = getBookmarks();
        const index = bookmarks.indexOf(chapterId);
        if (index === -1) {
            bookmarks.push(chapterId);
        } else {
            bookmarks.splice(index, 1);
        }
        localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
        const chapter = allChapters.find(item => String(item.id) === String(chapterId));
        captureLearningOperation(index === -1 ? 'bookmark.add' : 'bookmark.remove', { chapterId }, { status:'succeeded' }, { ...learningContext(), chapterId, chapterTitle:chapter?.title || '' });
        return index === -1; // 返回是否添加了書籤
    } catch (e) {
        console.error("Error toggling bookmark:", e);
        return false;
    }
}

// 檢查是否已收藏
function isBookmarked(chapterId) {
    return getBookmarks().includes(chapterId);
}

// 獲取統計信息
function getStats() {
    const progress = projectDisplayChapterIds(getReadProgress());
    const bookmarks = projectDisplayChapterIds(getBookmarks());
    const total = displayCatalogue?.chapters.length || 0;
    return {
        readCount: progress.length,
        bookmarkCount: bookmarks.length,
        totalChapters: total,
        readPercentage: total > 0 ? Math.round((progress.length / total) * 100) : 0
    };
}

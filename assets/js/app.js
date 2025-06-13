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

// ----- DOM 元素引用 -----
let chapterMenuEl, messagesEl, inputAreaEl, userInputAreaEl, userInputEl,
    sendInputBtnEl, btnYangEl, toggleMenuBtnEl, toggleDarkBtnEl,
    sidebarEl, mainHeaderEl;

// ----- Constants -----
const animals = ['🐶', '🐱', '🐷', '🦊', '🐻', '🐨', '🐼', '🐰', '🐯', '🦁', '🐬', '🐳', '🦉', '🦋']; // More animals

/* ========== 初始化 ========== */
document.addEventListener("DOMContentLoaded", () => {
    applyDarkModePreference();
    initializeDOMElements();
    bindEventListeners();
    loadDialogues();
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
    mainHeaderEl = document.querySelector("#main-content > header"); // Use querySelector for specificity
}

function bindEventListeners() {
    if (toggleMenuBtnEl) toggleMenuBtnEl.addEventListener("click", toggleMenu);
    if (toggleDarkBtnEl) toggleDarkBtnEl.addEventListener("click", toggleDarkMode);
    if (userInputEl) {
        userInputEl.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleUserInput();
            }
        });
    }
}

/* ========== 數據載入與目錄生成 ========== */
function loadDialogues() {
  fetch("data/dialogues.json")
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) throw new Error("dialogues.json empty/invalid");
      allChapters = data;
      groupChapters();
      renderChapterMenu();
      displayInitialRandomAnalect();
      if(btnYangEl) btnYangEl.disabled = true;
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
    if (!allChapters || allChapters.length === 0) return;
    const randomIndex = Math.floor(Math.random() * allChapters.length);
    const randomChapter = allChapters[randomIndex];
    if (!randomChapter) return;

    const title = randomChapter.title;
    const text = randomChapter.text;
    const translation = randomChapter.translation || "（暫無譯文）";
    const annotations = randomChapter.annotations || "（暫無注釋）";

    if (messagesEl) {
        messagesEl.innerHTML = ''; // Clear first
        addMessage(`**隨機章節：${title}**\n\n${text}\n\n**譯文：**\n${translation}\n\n**注釋：**\n${annotations}`, 'initial');
        addMessage("或者，請你自己從左側目錄選擇章節研讀。", 'system');
    }
}

function groupChapters() {
    groupedChapters = {};
    allChapters.forEach(item => {
        const match = item.title.match(/(?:(\S+)\s+)?(\d+)\.(\d+)/);
        if (!match) {
            const numMatch = item.title.match(/^(\d+)\.(\d+)$/);
            if (numMatch) {
                const major = parseInt(numMatch[1], 10); const minor = parseInt(numMatch[2], 10);
                 if (isNaN(major) || major < 1 || major > 20) return;
                 if (!groupedChapters[major]) groupedChapters[major] = { chapters: [] };
                 groupedChapters[major].chapters.push({...item, major: major, minor: minor});
            } else { console.warn(`Cannot parse title: ${item.title}`); return; }
        } else {
             const chapterName = match[1]; const major = parseInt(match[2], 10); const minor = parseInt(match[3], 10);
             if (isNaN(major) || major < 1 || major > 20) return;
             if (!groupedChapters[major]) { groupedChapters[major] = { name: chapterName, chapters: [] }; }
             else if (chapterName && !groupedChapters[major].name) { groupedChapters[major].name = chapterName; }
             groupedChapters[major].chapters.push({...item, major: major, minor: minor});
        }
    });
    for (const major in groupedChapters) { groupedChapters[major].chapters.sort((a, b) => a.minor - b.minor); }
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
        if(activeSubMenu.container.contains(activeSubMenu.element)) { activeSubMenu.container.removeChild(activeSubMenu.element); }
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
        a.dataset.id = item.id;
        if (getViewedChapters().includes(item.id)) {
            a.classList.add('visited');
        }
        a.onclick = (e) => { e.preventDefault(); displayChapter(item.id);
             if (window.innerWidth <= 768 && chapterMenuEl && chapterMenuEl.style.display !== 'none') { toggleMenu(); } };
        subMenuContainer.appendChild(a);
    });
    container.appendChild(subMenuContainer);
    activeSubMenu = { element: subMenuContainer, container: container, button: container.querySelector('.major-chapter-btn') };
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

  // Add the chapter title/text with a specific class for styling
  const chapterMessage = addMessage(`**${chapter.title}**\n\n${chapter.text}`, 'system');
  if (chapterMessage) {
      chapterMessage.classList.add('chapter-display'); // Add class
  }

  recordViewedChapter(id);
  markVisitedLinks(id);

  // Enable the Yang button and show its area
  if(btnYangEl) btnYangEl.disabled = false;
  if (inputAreaEl) inputAreaEl.style.display = 'flex';

}

// 重置對話狀態
function resetInteractionState() {
    conversationHistory = []; currentInteractionType = null; isWaitingForAI = false;
    removeLoadingMessage();
    if (messagesEl) messagesEl.innerHTML = ""; // Always clear messages
    if (userInputAreaEl) userInputAreaEl.style.display = "none";
    if (userInputEl) userInputEl.value = "";
    if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」";
    if (inputAreaEl) inputAreaEl.style.display = 'flex';
    if(btnYangEl) btnYangEl.disabled = !currentAnalect;
    if(sendInputBtnEl) sendInputBtnEl.disabled = false;
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
function addMessage(messageText, sender = "system", isError = false) {
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
        conversationHistory.push({ role: sender, content: messageText });
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


// Ask Gemini Helper
function askGemini(prompt, callback) {
    if (isWaitingForAI) {
        console.warn("AI processing...");
        // Maybe add a brief non-loading system message?
        // addMessage("AI正在處理上一個請求...", "system");
        return;
    }
    disableInteractionButtons();
    // Loading message is added *before* calling this function

    fetch(CLOUD_FLARE_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt })
    })
    .then(response => {
        if (!response.ok) {
            // Try to parse error JSON from CF Worker
            return response.json().then(errData => {
                 throw new Error(`AI請求失敗 (${response.status}): ${errData.error || response.statusText}`);
            }).catch(() => {
                // Fallback if parsing error JSON fails
                throw new Error(`AI請求失敗 (${response.status}): ${response.statusText}`);
            });
        }
        return response.json();
    })
    .then(data => {
        removeLoadingMessage(); // Remove the externally added loading message
        enableInteractionButtons();
        callback(data.answer || "AI 未能提供有效回答。", false); // Success
    })
    .catch(error => {
        console.error("AI Error:", error);
        removeLoadingMessage(); // Remove the externally added loading message
        enableInteractionButtons();
        // Provide more user-friendly error messages
        let displayError = `唉，思緒略有阻塞，未能回應。`;
        if (error.message.includes("429")) displayError += " (似乎請求過於頻繁，請稍後再試)";
        else if (error.message.includes("502")) displayError += " (後端服務暫時無法連接)";
        else displayError += ` (${error.message})`; // Include specific error
        callback(displayError, true); // Error
    });
}

// 孔子語氣指令 (Keep full)
const confuciusPersonaInstruction = "你現在扮演中國古代的聖人孔子。請使用文雅、古典、蘊含哲理的語言風格回答問題，如同《論語》中的口吻。稱呼提問者為“汝”或“君”。論述時，務必旁徵博引，結合《論語》全文思想及歷代注疏（如集解、正義、集注等）精髓。可以在對話的第三輪後使用現代網絡用語或過於口語化的表達。回答需分點或分段，條理清晰。";


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
    addMessage(`**譯文**\n${translation}`, 'confucius');
    addMessage(`**注釋**\n${annotations}`, 'confucius');

    // 2. ADD specific loading message
    addMessage("Gemini正在和你一起分析這則內容⋯耐個心吧 🐶⋯", 'loading');

    // 3. Build Prompt
    const prompt = `${confuciusPersonaInstruction}\n\n吾觀此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文：${translation}\n註疏：${annotations}\n\n請基於《論語》全文思想及歷代注疏，對此章進行深入分析，闡述其微言大義。`;

    // 4. Call AI
    askGemini(prompt, (aiAnswer, isError) => {
        // Loading message removed inside askGemini
        if (!isError) {
            addMessage(aiAnswer, 'confucius');
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
                if(chapterMessage) chapterMessage.classList.add('chapter-display');
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

    // 2. ADD specific animal loading message
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    addMessage(`Gemini正在和你一起分析這則內容⋯耐個心吧 ${randomAnimal}⋯`, 'loading');

    // 3. Build Prompt
    const historyString = formatHistoryForAI(conversationHistory); // History now includes user/ai msgs
    let contextInfo = `當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文與注釋已閱。`;
    const prompt = `${confuciusPersonaInstruction}\n\n${contextInfo}\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請繼續以孔子身份，針對用戶最新提問進行回應 ---`;

    // 4. Call AI
    askGemini(prompt, (aiAnswer, isError) => {
        // Loading message removed inside askGemini
        addMessage(aiAnswer, isError ? 'system' : 'confucius', isError);
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
    localStorage.setItem("darkMode", document.body.classList.contains("dark-mode") ? "enabled" : "disabled");
}

// Apply Dark Mode Preference on Load
function applyDarkModePreference() {
    if (localStorage.getItem("darkMode") === "enabled") {
        document.body.classList.add("dark-mode");
    }
}

// ---- Progress Tracking ----
function getViewedChapters() {
    try {
        return JSON.parse(localStorage.getItem('viewedChapters')) || [];
    } catch (e) {
        return [];
    }
}

function recordViewedChapter(id) {
    const viewed = getViewedChapters();
    if (!viewed.includes(id)) {
        viewed.push(id);
        localStorage.setItem('viewedChapters', JSON.stringify(viewed));
    }
}

function markVisitedLinks(id) {
    const links = document.querySelectorAll(`.sub-chapter-link[data-id="${id}"]`);
    links.forEach(link => link.classList.add('visited'));
}

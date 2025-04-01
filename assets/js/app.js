const CLOUD_FLARE_WORKER_URL = "https://apis.bdfz.workers.dev/";

// ----- 狀態變數 -----
let currentAnalect = null;
let allChapters = [];
let groupedChapters = {};
let conversationHistory = [];
let currentInteractionType = null; // Only 'yang' or null now
let isWaitingForAI = false;
let activeSubMenu = null;
let currentLoadingElement = null; // Store ref to the active loading message

// ----- DOM 元素引用 -----
let chapterMenuEl, messagesEl, inputAreaEl, userInputAreaEl, userInputEl,
    sendInputBtnEl, btnYangEl, /* btnGeminiEl removed */ toggleMenuBtnEl, toggleDarkBtnEl,
    topBarEl; // Added top-bar ref

// ----- Constants -----
const animals = ['🐶', '🐱', '🐷', '🦊', '🐻', '🐨', '🐼', '🐰', '🐯', '🦁'];

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
    // btnGeminiEl removed
    toggleMenuBtnEl = document.getElementById("toggle-menu-btn");
    toggleDarkBtnEl = document.getElementById("toggle-dark-btn");
    topBarEl = document.getElementById("top-bar"); // Get top bar
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
    .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
    })
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("dialogues.json 資料格式有誤或為空");
      }
      allChapters = data;
      groupChapters();
      renderChapterMenu();
      displayInitialRandomAnalect(); // Display random quote on load
      // Initial state: No chapter selected, Yang button disabled
      if(btnYangEl) btnYangEl.disabled = true;
    })
    .catch(err => {
      console.error("讀取 dialogues.json 或初始化過程中出錯：", err);
      if (messagesEl) {
          messagesEl.innerHTML = ''; // Clear before adding error
          addMessage(`錯誤：無法載入論語數據。請檢查文件或聯繫管理員。\n(${err.message})`, 'system', true);
      }
      disableInteractionButtons(true); // Permanently disable button on error
    });
}

// Display initial random content
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
        messagesEl.innerHTML = ''; // Clear previous messages
        addMessage(`**隨機章節：${title}**\n\n${text}\n\n**譯文：**\n${translation}\n\n**注釋：**\n${annotations}`, 'initial'); // Use 'initial' type or 'system'
        addMessage("或者，請你自己從左側目錄選擇章節研讀。", 'system'); // Updated prompt
    }
}

// Add 'initial' class style in CSS if needed, or just use 'system'
// .message-container.initial { /* Styles for initial random quote */ }


// groupChapters (保持不變 from previous)
function groupChapters() {
    groupedChapters = {};
    allChapters.forEach(item => {
        const match = item.title.match(/(?:(\S+)\s+)?(\d+)\.(\d+)/);
        if (!match) {
            const numMatch = item.title.match(/^(\d+)\.(\d+)$/);
            if (numMatch) {
                const major = parseInt(numMatch[1], 10);
                const minor = parseInt(numMatch[2], 10);
                 if (isNaN(major) || major < 1 || major > 20) return;
                 if (!groupedChapters[major]) groupedChapters[major] = { chapters: [] };
                 groupedChapters[major].chapters.push({...item, major: major, minor: minor});
            } else {
                 console.warn(`無法解析標題格式: ${item.title}`);
                 return;
            }
        } else {
             const chapterName = match[1];
             const major = parseInt(match[2], 10);
             const minor = parseInt(match[3], 10);
             if (isNaN(major) || major < 1 || major > 20) return;

             if (!groupedChapters[major]) {
                 groupedChapters[major] = { name: chapterName, chapters: [] };
             } else if (chapterName && !groupedChapters[major].name) {
                 groupedChapters[major].name = chapterName;
             }
             groupedChapters[major].chapters.push({...item, major: major, minor: minor});
        }
    });
    for (const major in groupedChapters) {
        groupedChapters[major].chapters.sort((a, b) => a.minor - b.minor);
    }
}

// renderChapterMenu (保持不變 from previous)
function renderChapterMenu() {
    if (!chapterMenuEl) return;
    chapterMenuEl.innerHTML = "";
    const sortedMajors = Object.keys(groupedChapters).map(Number).sort((a, b) => a - b);
    sortedMajors.forEach(major => {
        const chapterData = groupedChapters[major];
        const container = document.createElement('div');
        container.className = 'major-chapter-container';
        const btn = document.createElement("button");
        btn.textContent = chapterData.name ? `${chapterData.name} (第 ${major} 章)` : `第 ${major} 章`;
        btn.classList.add('ghibli-button', 'major-chapter-btn');
        btn.dataset.major = major;
        btn.onclick = (e) => {
            e.preventDefault();
            toggleSubChapterMenu(major, container, btn);
        };
        container.appendChild(btn);
        chapterMenuEl.appendChild(container);
    });
}

// toggleSubChapterMenu (保持不變 from previous)
function toggleSubChapterMenu(major, container, button) {
    if (activeSubMenu && activeSubMenu.container !== container) {
        if(activeSubMenu.container.contains(activeSubMenu.element)) { // Check if still attached
             activeSubMenu.container.removeChild(activeSubMenu.element);
        }
        activeSubMenu.button.classList.remove('active');
        activeSubMenu = null;
    }
    const existingSubMenu = container.querySelector('.sub-menu-container');
    if (existingSubMenu) {
        container.removeChild(existingSubMenu);
        button.classList.remove('active');
        activeSubMenu = null;
    } else {
        renderSubChapterMenu(major, container);
        button.classList.add('active');
    }
}

// renderSubChapterMenu (保持不變 from previous)
function renderSubChapterMenu(major, container) {
    const subChapters = groupedChapters[major]?.chapters;
    if (!subChapters || subChapters.length === 0) return;
    const subMenuContainer = document.createElement("div");
    subMenuContainer.className = "sub-menu-container";
    subChapters.forEach(item => {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = `${item.major}.${item.minor}`;
        a.classList.add('ghibli-button', 'sub-chapter-link');
        a.onclick = (e) => {
            e.preventDefault();
            displayChapter(item.id); // Display selected chapter
            // Close the menu maybe? Especially on mobile.
             if (window.innerWidth <= 768 && chapterMenuEl && chapterMenuEl.style.display !== 'none') {
                 toggleMenu();
             }
        };
        subMenuContainer.appendChild(a);
    });
    container.appendChild(subMenuContainer);
    activeSubMenu = { element: subMenuContainer, container: container, button: container.querySelector('.major-chapter-btn') };
}


// 顯示指定 ID 的論語內容到對話框
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id == id);
  if (!chapter) {
    console.error("找不到章節 id:", id);
    // Add error message without clearing potentially useful previous content?
    addMessage(`錯誤：找不到 ID 為 ${id} 的章節。`, 'system', true);
    return;
  }
  currentAnalect = chapter;

  resetInteractionState(); // Clear messages, history, reset button states

  // Add the chapter title and text
  addMessage(`當前章節： **${chapter.title}**\n\n${chapter.text}`, 'system');

  // Enable the Yang button
  if(btnYangEl) btnYangEl.disabled = false;
  if (inputAreaEl) inputAreaEl.style.display = 'flex'; // Ensure button area is visible

}

// 重置對話狀態、按鈕文本和輸入框
function resetInteractionState() {
    conversationHistory = [];
    currentInteractionType = null;
    isWaitingForAI = false;
    removeLoadingMessage(); // Remove any stale loading messages

    if (messagesEl) messagesEl.innerHTML = ""; // Clear messages

    if (userInputAreaEl) userInputAreaEl.style.display = "none"; // Hide input box
    if (userInputEl) userInputEl.value = "";

    // Restore Yang button text and ensure it's visible
    if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」";
    if (inputAreaEl) inputAreaEl.style.display = 'flex'; // Show button area

    // Disable Yang button if no chapter context, enable otherwise
    if(btnYangEl) btnYangEl.disabled = !currentAnalect;

    if(sendInputBtnEl) sendInputBtnEl.disabled = false;
}

// 啟用交互按鈕 (Simplified)
function enableInteractionButtons() {
    if (currentAnalect && btnYangEl) btnYangEl.disabled = false; // Only enable if chapter selected
    if (sendInputBtnEl) sendInputBtnEl.disabled = false;
    isWaitingForAI = false;
}

// 禁用交互按鈕 (Simplified)
function disableInteractionButtons(permanently = false) {
    if (btnYangEl) btnYangEl.disabled = true;
    if (sendInputBtnEl) sendInputBtnEl.disabled = true;
    if (!permanently) {
        isWaitingForAI = true;
    }
}

/* ========== AI 互動相關函式 ========== */

// 格式化文本 (保持不變)
function formatMessageText(text) {
    if (!text) return "";
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const paragraphs = text.split(/\n\s*\n+/);
    return paragraphs.map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('');
}

// Add Message (Add 'initial' class handling if needed)
function addMessage(messageText, sender = "system", isError = false) {
  if (!messagesEl) return;
  const messageContainer = document.createElement("div");
  // Ensure sender corresponds to CSS classes: 'user', 'ai', 'confucius', 'system', 'loading', 'initial'
  messageContainer.classList.add("message-container", sender);
  if (isError) messageContainer.style.color = 'red';

  if (sender === 'loading') {
      messageContainer.classList.add('loading-message');
      messageContainer.innerHTML = `<p>${messageText}</p>`;
      currentLoadingElement = messageContainer; // Store reference to loading message
  } else {
       if (sender === 'system' && messageText.includes('**')) {
           messageText = messageText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
       } else if (sender === 'initial') { // Handle initial quote formatting
            messageText = messageText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
       }
      messageContainer.innerHTML = formatMessageText(messageText);
  }

  messagesEl.appendChild(messageContainer);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // Don't add system/initial/loading messages to history for AI
  if (sender !== 'loading' && sender !== 'system' && sender !== 'initial') {
      conversationHistory.push({ role: sender, content: messageText });
  }
  return messageContainer; // Return element mainly for loading message removal
}

// Remove the currently tracked loading message
function removeLoadingMessage() {
    if (currentLoadingElement && messagesEl && messagesEl.contains(currentLoadingElement)) {
        messagesEl.removeChild(currentLoadingElement);
    }
    currentLoadingElement = null; // Clear reference
}

// formatHistoryForAI (保持不變)
function formatHistoryForAI(history) {
    return history.map(msg => {
        let roleName = msg.role;
        if (roleName === 'confucius' || roleName === 'ai') roleName = '孔子';
        else if (roleName === 'user') roleName = '用戶';
        else return null; // Exclude other types like system, initial, loading
        return `${roleName}：\n${msg.content}`;
    }).filter(Boolean).join('\n\n');
}


// askGemini - **REMOVED internal loading message logic**
function askGemini(prompt, callback) {
  if (isWaitingForAI) {
      console.warn("AI is already processing a request.");
      // Optionally add a *system* message instead of loading?
      // addMessage("AI正在處理，請勿重複提交。", "system");
      return;
  }
  disableInteractionButtons();
  // Loading message is now added *before* calling askGemini

  fetch(CLOUD_FLARE_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                 throw new Error(`AI請求失敗 (${response.status}): ${errData.error || response.statusText}`);
            }).catch(() => {
                throw new Error(`AI請求失敗 (${response.status}): ${response.statusText}`);
            });
        }
        return response.json();
    })
    .then(data => {
      removeLoadingMessage(); // Remove loading message added *externally*
      enableInteractionButtons();
      callback(data.answer || "AI 未能提供有效回答。", false);
    })
    .catch(error => {
      console.error("AI 請求失敗：", error);
      removeLoadingMessage(); // Remove loading message added *externally*
      enableInteractionButtons();
      let displayError = `唉，思緒略有阻塞，未能回應。`;
      if (error.message.includes("429")) displayError += " (似乎請求過於頻繁，請稍後再試)";
      else if (error.message.includes("502")) displayError += " (後端服務暫時無法連接)";
      else displayError += ` (${error.message})`;
      callback(displayError, true);
    });
}


// 孔子語氣指令 (保持不變)
const confuciusPersonaInstruction = "你現在扮演中國古代的聖人孔子。請使用文雅、古典、蘊含哲理的語言風格回答問題，如同《論語》中的口吻。稱呼提問者為“汝”或“君”。論述時，務必旁徵博引，結合《論語》全文思想及歷代注疏（如集解、正義、集注等）精髓。避免使用現代網絡用語或過於口語化的表達。回答需分點或分段，條理清晰。";

/* ========== 按鈕點擊處理 ========== */

// 處理點擊「楊伯峻「論語譯註」」按鈕
function handleYangAnnotationClick() {
  if (!currentAnalect || isWaitingForAI) return;

  // Clear history, set type, keep initial system message
  conversationHistory = [];
  currentInteractionType = 'yang';
  const firstMessage = messagesEl.querySelector('.message-container.system'); // Assumes first system message is the chapter text
  messagesEl.innerHTML = '';
  if (firstMessage) messagesEl.appendChild(firstMessage);

  const translation = currentAnalect.translation || "（暫無譯文）";
  const annotations = currentAnalect.annotations || "（暫無注釋）";

  // 1. Add translation and annotations
  addMessage(`**譯文**\n${translation}`, 'confucius');
  addMessage(`**注釋**\n${annotations}`, 'confucius');

  // 2. **ADD specific loading message**
  addMessage("Gemini正在和你一起分析這則內容⋯耐個心吧 🐶⋯", 'loading');

  // 3. Build Prompt
  const prompt = `${confuciusPersonaInstruction}\n\n吾觀此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文：${translation}\n註疏：${annotations}\n\n請基於《論語》全文思想及歷代注疏，對此章進行深入分析，闡述其微言大義。`;

  // 4. Call AI
  askGemini(prompt, (aiAnswer, isError) => {
      // Loading message is removed inside askGemini's callback now
      if (!isError) {
          addMessage(aiAnswer, 'confucius');
          // 5. **Hide button area, show input area**
          if (inputAreaEl) inputAreaEl.style.display = "none"; // Hide the button area
          if (userInputAreaEl) userInputAreaEl.style.display = "flex";
          if (userInputEl) userInputEl.focus();
      } else {
          addMessage(aiAnswer, 'system', true);
          resetInteractionState();
          if (currentAnalect) addMessage(`當前章節： **${currentAnalect.title}**\n\n${currentAnalect.text}`, 'system');
      }
  });
}

// **handleGeminiAnalysisClick function REMOVED**

// 處理用戶輸入
function handleUserInput() {
  if (!userInputEl || isWaitingForAI) return;
  const userText = userInputEl.value.trim();
  if (!userText) return;

  if (!currentInteractionType) { // Should ideally not happen if input box is only shown after first interaction
      addMessage("內部錯誤：未設定對話類型。", "system", true);
      return;
  }

  // 1. Add user message
  addMessage(userText, 'user');
  userInputEl.value = "";

  // 2. **ADD specific animal loading message**
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  addMessage(`Gemini正在和你一起分析這則內容⋯耐個心吧 ${randomAnimal}⋯`, 'loading');


  // 3. Build Prompt
  const historyString = formatHistoryForAI(conversationHistory.filter(m => m.role !== 'system'));
  // Context is now simpler as there's only one interaction type path
  let contextInfo = `當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文與注釋已閱。`;
  const prompt = `${confuciusPersonaInstruction}\n\n${contextInfo}\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請繼續以孔子身份，針對用戶最新提問進行回應 ---`;

  // 4. Call AI
  askGemini(prompt, (aiAnswer, isError) => {
       // Loading message removed inside askGemini callback
      addMessage(aiAnswer, isError ? 'system' : 'confucius', isError);
      if (userInputEl && !isError) userInputEl.focus();
  });
}


/* ========== 其他功能 ========== */

// toggleMenu (保持不變)
function toggleMenu() {
    if (!chapterMenuEl || !toggleMenuBtnEl) return;
    const isHidden = chapterMenuEl.style.display === "none";
    chapterMenuEl.style.display = isHidden ? "flex" : "none";
    toggleMenuBtnEl.textContent = isHidden ? "隱藏目錄" : "顯示目錄";
    if (!isHidden && activeSubMenu) {
         if (activeSubMenu.container.contains(activeSubMenu.element)) {
              activeSubMenu.container.removeChild(activeSubMenu.element);
         }
         activeSubMenu.button.classList.remove('active');
         activeSubMenu = null;
    }
}

// toggleDarkMode (保持不變)
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("darkMode", document.body.classList.contains("dark-mode") ? "enabled" : "disabled");
}

// applyDarkModePreference (保持不變)
function applyDarkModePreference() {
    if (localStorage.getItem("darkMode") === "enabled") {
        document.body.classList.add("dark-mode");
    }
}
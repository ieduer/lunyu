const CLOUD_FLARE_WORKER_URL = "https://apis.bdfz.workers.dev/";

// ----- 狀態變數 -----
let currentAnalect = null;
let allChapters = [];
let groupedChapters = {};
let conversationHistory = [];
let currentInteractionType = null;
let isWaitingForAI = false;
let activeSubMenu = null; // Reference to the currently visible Level 2 menu container

// ----- DOM 元素引用 -----
let chapterMenuEl, messagesEl, inputAreaEl, userInputAreaEl, userInputEl,
    sendInputBtnEl, btnYangEl, btnGeminiEl, toggleMenuBtnEl, toggleDarkBtnEl;

/* ========== 初始化 ========== */
document.addEventListener("DOMContentLoaded", () => {
    applyDarkModePreference();
    initializeDOMElements(); // Get elements first
    bindEventListeners();    // Then bind events
    loadDialogues();         // Finally load data
});

// 初始化 DOM 元素引用
function initializeDOMElements() {
    chapterMenuEl = document.getElementById("chapter-menu");
    messagesEl = document.getElementById("messages");
    inputAreaEl = document.getElementById("input-area");
    userInputAreaEl = document.getElementById("user-input-area");
    userInputEl = document.getElementById("user-input");
    sendInputBtnEl = document.getElementById("send-input-btn");
    btnYangEl = document.getElementById("btn-yang");
    btnGeminiEl = document.getElementById("btn-gemini");
    toggleMenuBtnEl = document.getElementById("toggle-menu-btn");
    toggleDarkBtnEl = document.getElementById("toggle-dark-btn");
}

// 綁定只需要執行一次的事件監聽器
function bindEventListeners() {
    if (toggleMenuBtnEl) {
        toggleMenuBtnEl.addEventListener("click", toggleMenu);
    }
    if (toggleDarkBtnEl) {
        toggleDarkBtnEl.addEventListener("click", toggleDarkMode);
    }
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
      groupChapters(); // Group chapters first
      renderChapterMenu(); // Then render menu
      // No default display, user must select from menu
      // displayChapter(data[randomIndex].id); // Remove default display
      setInitialDialogueMessage(); // Set initial message
    })
    .catch(err => {
      console.error("讀取 dialogues.json 或初始化過程中出錯：", err);
      if (messagesEl) addMessage(`錯誤：無法載入論語數據。請檢查文件或聯繫管理員。\n(${err.message})`, 'system', true);
      // Disable interaction buttons if data fails to load
      disableInteractionButtons(true); // Pass true to permanently disable
    });
}

// 設置初始對話框消息
function setInitialDialogueMessage() {
    if (messagesEl) {
        messagesEl.innerHTML = ''; // Clear any previous messages (like loading errors)
        addMessage("請從左側目錄選擇章節開始學習。", 'system');
    }
     // Ensure interaction buttons are initially disabled
    if(btnYangEl) btnYangEl.disabled = true;
    if(btnGeminiEl) btnGeminiEl.disabled = true;
}


// 根據 title 分組章節 - **UPDATED REGEX**
function groupChapters() {
    groupedChapters = {};
    allChapters.forEach(item => {
        // Regex: Optional non-capturing group for "章名 ", then capture major.minor
        const match = item.title.match(/(?:(\S+)\s+)?(\d+)\.(\d+)/);
        if (!match) {
            // Handle titles that are JUST numbers like "12.16"
            const numMatch = item.title.match(/^(\d+)\.(\d+)$/);
            if (numMatch) {
                const major = parseInt(numMatch[1], 10);
                const minor = parseInt(numMatch[2], 10); // Keep minor for sorting later if needed
                 if (isNaN(major) || major < 1 || major > 20) return;
                 if (!groupedChapters[major]) groupedChapters[major] = { chapters: [] };
                 groupedChapters[major].chapters.push({...item, major: major, minor: minor}); // Store numbers
            } else {
                 console.warn(`無法解析標題格式: ${item.title}`); // Log other unparsable formats
                 return;
            }
        } else {
             const chapterName = match[1]; // Might be undefined
             const major = parseInt(match[2], 10);
             const minor = parseInt(match[3], 10);
             if (isNaN(major) || major < 1 || major > 20) return; // Assume 20 chapters max

             if (!groupedChapters[major]) {
                 groupedChapters[major] = { name: chapterName, chapters: [] }; // Store name if available
             } else if (chapterName && !groupedChapters[major].name) {
                 groupedChapters[major].name = chapterName; // Add name if found later for the same chapter
             }
             groupedChapters[major].chapters.push({...item, major: major, minor: minor}); // Store numbers
        }

    });

    // Sort sub-chapters numerically within each major chapter
    for (const major in groupedChapters) {
        groupedChapters[major].chapters.sort((a, b) => a.minor - b.minor);
    }
}


// 渲染第一級目錄 (章號)
function renderChapterMenu() {
    if (!chapterMenuEl) return;
    chapterMenuEl.innerHTML = "";

    const sortedMajors = Object.keys(groupedChapters).map(Number).sort((a, b) => a - b);

    sortedMajors.forEach(major => {
        const chapterData = groupedChapters[major];

        // Create a container for the major chapter button and its sub-menu
        const container = document.createElement('div');
        container.className = 'major-chapter-container';

        const btn = document.createElement("button");
        // Use Chapter Name if available, otherwise default to "第 X 章"
        btn.textContent = chapterData.name ? `${chapterData.name} (第 ${major} 章)` : `第 ${major} 章`;
        btn.classList.add('ghibli-button', 'major-chapter-btn');
        btn.dataset.major = major; // Store major number for reference
        btn.onclick = (e) => {
            e.preventDefault();
            toggleSubChapterMenu(major, container, btn); // Pass container and button
        };

        container.appendChild(btn); // Add button to container
        chapterMenuEl.appendChild(container); // Add container to menu
    });
}

// 切換顯示/隱藏第二級目錄
function toggleSubChapterMenu(major, container, button) {
    // Close previously active sub-menu
    if (activeSubMenu && activeSubMenu.container !== container) {
        activeSubMenu.container.removeChild(activeSubMenu.element);
        activeSubMenu.button.classList.remove('active'); // Deactivate previous button
        activeSubMenu = null;
    }

    // Check if the clicked menu is already open
    const existingSubMenu = container.querySelector('.sub-menu-container');
    if (existingSubMenu) {
        // Close it
        container.removeChild(existingSubMenu);
        button.classList.remove('active');
        activeSubMenu = null;
    } else {
        // Open it
        renderSubChapterMenu(major, container); // Pass container to render into
        button.classList.add('active'); // Mark button as active
    }
}


// 渲染第二級目錄 (子節號) - Renders inside the provided container
function renderSubChapterMenu(major, container) {
    const subChapters = groupedChapters[major]?.chapters;
    if (!subChapters || subChapters.length === 0) return;

    const subMenuContainer = document.createElement("div");
    subMenuContainer.className = "sub-menu-container";
    // CSS handles grid layout

    subChapters.forEach(item => {
        const a = document.createElement("a");
        a.href = "#";
        // Use stored major.minor or reconstruct from title
        a.textContent = `${item.major}.${item.minor}`;
        a.classList.add('ghibli-button', 'sub-chapter-link');
        a.onclick = (e) => {
            e.preventDefault();
            displayChapter(item.id);
            // Optional: Close the sidebar menu on selection?
            // if (window.innerWidth <= 768) toggleMenu(); // Example: Close on mobile
        };
        subMenuContainer.appendChild(a);
    });

    container.appendChild(subMenuContainer); // Append sub-menu to the major chapter container

    // Store reference to the active sub-menu
    activeSubMenu = { element: subMenuContainer, container: container, button: container.querySelector('.major-chapter-btn') };
}


// 顯示指定 ID 的論語內容到對話框
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id == id);
  if (!chapter) {
    console.error("找不到章節 id:", id);
    addMessage(`錯誤：找不到 ID 為 ${id} 的章節。`, 'system', true);
    return;
  }
  currentAnalect = chapter;

  // Reset interaction state (clears messages, history, resets buttons)
  resetInteractionState();

  // Add the chapter title and text as the first message in the dialogue
  addMessage(`當前章節： **${chapter.title}**\n\n${chapter.text}`, 'system');

  // Enable the interaction buttons now that a chapter is loaded
  if(btnYangEl) btnYangEl.disabled = false;
  if(btnGeminiEl) btnGeminiEl.disabled = false;

}

// 重置對話狀態、按鈕文本和輸入框
function resetInteractionState() {
    conversationHistory = [];
    currentInteractionType = null;
    isWaitingForAI = false;
    if (messagesEl) messagesEl.innerHTML = ""; // Clear messages
    if (userInputAreaEl) userInputAreaEl.style.display = "none";
    if (userInputEl) userInputEl.value = "";

    // Restore default button text
    if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」";
    if (btnGeminiEl) btnGeminiEl.textContent = "Gemini 解讀";

    // Keep buttons enabled unless no chapter is selected (handled in displayChapter)
     // Or disable them if no chapter is selected yet
    if (!currentAnalect) {
       if(btnYangEl) btnYangEl.disabled = true;
       if(btnGeminiEl) btnGeminiEl.disabled = true;
    } else {
        if(btnYangEl) btnYangEl.disabled = false;
       if(btnGeminiEl) btnGeminiEl.disabled = false;
    }
    if(sendInputBtnEl) sendInputBtnEl.disabled = false; // Ensure send button is enabled initially when input shows
}

// 啟用交互按鈕
function enableInteractionButtons() {
    // Only enable main buttons if a chapter is selected
    if (currentAnalect) {
        if (btnYangEl) btnYangEl.disabled = false;
        if (btnGeminiEl) btnGeminiEl.disabled = false;
    }
    if (sendInputBtnEl) sendInputBtnEl.disabled = false;
    isWaitingForAI = false;
}

// 禁用交互按鈕
function disableInteractionButtons(permanently = false) {
    if (btnYangEl) btnYangEl.disabled = true;
    if (btnGeminiEl) btnGeminiEl.disabled = true;
    if (sendInputBtnEl) sendInputBtnEl.disabled = true;
    if (!permanently) { // Only set waiting flag if not permanent
        isWaitingForAI = true;
    }
}

/* ========== AI 互動相關函式 ========== */

// 格式化文本 (保持不變 from previous)
function formatMessageText(text) {
    if (!text) return "";
    // Use Markdown-like ** for bolding titles if needed (simple replacement)
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const paragraphs = text.split(/\n\s*\n+/);
    return paragraphs.map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('');
}

// 向對話框添加消息 (保持不變 from previous, check sender classes)
function addMessage(messageText, sender = "system", isError = false) {
  if (!messagesEl) return;

  const messageContainer = document.createElement("div");
  // Ensure sender corresponds to CSS classes: 'user', 'ai', 'confucius', 'system', 'loading'
  messageContainer.classList.add("message-container", sender);
  if (isError) messageContainer.style.color = 'red'; // Or add an 'error' class

  if (sender === 'loading') {
      messageContainer.classList.add('loading-message');
      messageContainer.innerHTML = `<p>${messageText}</p>`;
  } else {
       // Add bolding for titles in system messages
       if (sender === 'system' && messageText.includes('**')) {
           messageText = messageText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
       }
      messageContainer.innerHTML = formatMessageText(messageText);
  }

  messagesEl.appendChild(messageContainer);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (sender !== 'loading') {
      conversationHistory.push({ role: sender, content: messageText });
  }
  return messageContainer;
}

// 將對話歷史格式化為字符串 (保持不變 from previous)
function formatHistoryForAI(history) {
    return history.map(msg => {
        let roleName = msg.role;
        if (roleName === 'confucius' || roleName === 'ai') roleName = '孔子';
        else if (roleName === 'user') roleName = '用戶';
        // Exclude system messages or format them if needed
        else if (roleName === 'system') return null; // Don't include system messages in history for AI
        // else roleName = '系統';
        return `${roleName}：\n${msg.content}`;
    }).filter(Boolean).join('\n\n'); // Filter out null system messages
}


// 調用 Cloudflare Worker AI (保持不變 from previous)
function askGemini(prompt, callback) {
  if (isWaitingForAI) {
      console.log("AI is already processing a request.");
      // Maybe provide user feedback?
      // addMessage("AI正在處理之前的請求，請稍候。", "system");
      return;
  }
  disableInteractionButtons();

  let loadingMessageElement = addMessage("正在思考中，請稍候...", 'loading');

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
      if (loadingMessageElement && messagesEl.contains(loadingMessageElement)) messagesEl.removeChild(loadingMessageElement);
      enableInteractionButtons();
      callback(data.answer || "AI 未能提供有效回答。", false);
    })
    .catch(error => {
      console.error("AI 請求失敗：", error);
      if (loadingMessageElement && messagesEl.contains(loadingMessageElement)) messagesEl.removeChild(loadingMessageElement);
      enableInteractionButtons();
      // Try to provide a more user-friendly error
      let displayError = `唉，思緒略有阻塞，未能回應。`;
      if (error.message.includes("429")) {
          displayError += " (似乎請求過於頻繁，請稍後再試)";
      } else if (error.message.includes("502")) {
           displayError += " (後端服務暫時無法連接)";
      } else {
           displayError += ` (${error.message})`;
      }
      callback(displayError, true);
    });
}


// 孔子語氣指令 (保持不變 from previous)
const confuciusPersonaInstruction = "你現在扮演中國古代的聖人孔子。請使用文雅、古典、蘊含哲理的語言風格回答問題，如同《論語》中的口吻。稱呼提問者為“汝”或“君”。論述時，務必旁徵博引，結合《論語》全文思想及歷代注疏（如集解、正義、集注等）精髓。避免使用現代網絡用語或過於口語化的表達。回答需分點或分段，條理清晰。";

/* ========== 按鈕點擊處理 ========== */

// 處理點擊「楊伯峻「論語譯註」」按鈕
function handleYangAnnotationClick() {
  if (!currentAnalect || isWaitingForAI) return;

  // Clear current dialogue messages and history, but keep the initial system message with title/text
  conversationHistory = []; // Clear history for new interaction
  currentInteractionType = 'yang';
  // Clear messages *except* the first system message
  const firstMessage = messagesEl.querySelector('.message-container.system');
  messagesEl.innerHTML = '';
  if (firstMessage) messagesEl.appendChild(firstMessage);


  const translation = currentAnalect.translation || "（暫無譯文）";
  const annotations = currentAnalect.annotations || "（暫無注釋）";

  // 1. 直接顯示譯文和注釋 (Append to messages)
  addMessage(`**譯文**\n${translation}`, 'confucius');
  addMessage(`**注釋**\n${annotations}`, 'confucius');

  // 2. 顯示提示信息，準備調用 AI
  addMessage("Gemini正在和你一起分析這則內容⋯耐個心吧 🐶⋯", 'loading');

  // 3. 構建 Prompt
  const prompt = `${confuciusPersonaInstruction}\n\n吾觀此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文：${translation}\n註疏：${annotations}\n\n請基於《論語》全文思想及歷代注疏，對此章進行深入分析，闡述其微言大義。`;

  // 4. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      if (!isError) {
          addMessage(aiAnswer, 'confucius');
          // 5. **UPDATE BUTTON TEXT**
          if (btnYangEl) btnYangEl.textContent = "深度對話"; // Updated text
          if (btnGeminiEl) btnGeminiEl.textContent = "Gemini 解讀"; // Reset other button
          if (userInputAreaEl) userInputAreaEl.style.display = "flex";
          if (userInputEl) userInputEl.focus();
      } else {
          addMessage(aiAnswer, 'system', true);
          // Don't reset state on error, user might want to retry? Or maybe reset? Let's reset.
           resetInteractionState(); // Reset if AI fails initially
           // Re-add the chapter title message after reset
           if (currentAnalect) addMessage(`當前章節： **${currentAnalect.title}**\n\n${currentAnalect.text}`, 'system');
      }
  });
}

// 處理點擊「Gemini 解讀」按鈕
function handleGeminiAnalysisClick() {
  if (!currentAnalect || isWaitingForAI) return;

  conversationHistory = [];
  currentInteractionType = 'gemini';
  const firstMessage = messagesEl.querySelector('.message-container.system');
  messagesEl.innerHTML = '';
  if (firstMessage) messagesEl.appendChild(firstMessage);

  // 1. 顯示加載提示
  addMessage("Gemini正在思考歷代解說⋯請稍候...", 'loading');

  // 2. 構建 Prompt
  const prompt = `${confuciusPersonaInstruction}\n\n針對此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n\n請基於《論語》全文及歷代注疏、集解、正義、箋注等，詳盡列舉此章的歷代重要解說，尤其需呈現不同學派或觀點之異同。比較各家說法後，請選擇一說，闡明汝（AI）之所取及其緣由。`;

  // 3. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      if (!isError) {
          addMessage(aiAnswer, 'confucius');
          // 4. **UPDATE BUTTON TEXT**
          if (btnGeminiEl) btnGeminiEl.textContent = "深度對話"; // Updated text
          if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」"; // Reset other button
          if (userInputAreaEl) userInputAreaEl.style.display = "flex";
          if (userInputEl) userInputEl.focus();
      } else {
          addMessage(aiAnswer, 'system', true);
          resetInteractionState(); // Reset if AI fails initially
          if (currentAnalect) addMessage(`當前章節： **${currentAnalect.title}**\n\n${currentAnalect.text}`, 'system');
      }
  });
}

// 處理用戶輸入 (保持不變 from previous, check prompt logic)
function handleUserInput() {
  if (!userInputEl || isWaitingForAI) return;
  const userText = userInputEl.value.trim();
  if (!userText) return;

  if (!currentInteractionType) {
      addMessage("請先選擇一個對話主題（點擊“深度對話”按鈕）。", "system", true);
      return;
  }

  // 1. 添加用戶消息
  addMessage(userText, 'user');
  userInputEl.value = "";

  // 2. 構建 Prompt (Exclude system messages from history sent to AI)
  const historyString = formatHistoryForAI(conversationHistory.filter(m => m.role !== 'system')); // Filter system msgs
  let contextInfo = `當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}`;
  if (currentInteractionType === 'yang') {
      contextInfo += `\n譯文與注釋已閱。`;
  } else {
       contextInfo += `\n歷代解說已閱。`;
  }

  const prompt = `${confuciusPersonaInstruction}\n\n${contextInfo}\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請繼續以孔子身份，針對用戶最新提問進行回應 ---`;


  // 3. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      addMessage(aiAnswer, isError ? 'system' : 'confucius', isError);
      if (userInputEl && !isError) userInputEl.focus();
  });
}


/* ========== 其他功能 ========== */

// 切換目錄顯示/隱藏
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

// 切換夜晚模式
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("darkMode", document.body.classList.contains("dark-mode") ? "enabled" : "disabled");
}

// 頁面加載時檢查並應用夜晚模式偏好
function applyDarkModePreference() {
    if (localStorage.getItem("darkMode") === "enabled") {
        document.body.classList.add("dark-mode");
    }
}
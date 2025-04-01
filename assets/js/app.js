const CLOUD_FLARE_WORKER_URL = "https://apis.bdfz.workers.dev/";

// ----- 狀態變數 -----
let currentAnalect = null; // 當前選擇的論語條目
let allChapters = [];      // 所有論語數據
let groupedChapters = {};  // 按章分組的數據
let conversationHistory = []; // 當前對話歷史
let currentInteractionType = null; // 標記當前互動類型 ('yang', 'gemini', null)
let isWaitingForAI = false; // 標記是否正在等待 AI 回應

// ----- DOM 元素引用 (優化性能) -----
let chapterMenuEl, subChapterMenuEl, chapterContentEl, messagesEl,
    inputAreaEl, userInputAreaEl, userInputEl, sendInputBtnEl,
    btnYangEl, btnGeminiEl, toggleMenuBtnEl, toggleDarkBtnEl;

/* ========== 數據載入與目錄生成 ========== */
function loadDialogues() {
  fetch("data/dialogues.json")
    .then(res => {
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
    })
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) {
        console.error("dialogues.json 資料格式有誤或為空");
        // 可在此處向用戶顯示錯誤信息
        return;
      }
      allChapters = data;
      groupChapters();
      renderChapterMenu();
      // 預設顯示隨機一個子節
      const randomIndex = Math.floor(Math.random() * data.length);
      displayChapter(data[randomIndex].id);
      // 初始化 DOM 元素引用
      initializeDOMElements();
      // 綁定事件監聽器
      bindEventListeners();
    })
    .catch(err => {
        console.error("讀取 dialogues.json 或初始化過程中出錯：", err);
        // 可在此處向用戶顯示錯誤信息
        if(messagesEl) addMessage(`無法載入論語數據：${err.message}`, 'system', true);
    });
}

// 初始化 DOM 元素引用
function initializeDOMElements() {
    chapterMenuEl = document.getElementById("chapter-menu");
    subChapterMenuEl = document.getElementById("sub-chapter-menu");
    chapterContentEl = document.getElementById("chapter-content");
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
        // 允許按 Enter 發送 (Shift+Enter 換行)
        userInputEl.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // 阻止默認換行
                handleUserInput();
            }
        });
    }
}


// 根據 title 分組章節
function groupChapters() {
  groupedChapters = {}; // 重置
  allChapters.forEach(item => {
    const match = item.title.match(/^(\S+)\s+(\d+)\.(\d+)/); // 改進正則以匹配 "學而 1.1"
    if (!match) {
        console.warn(`無法解析標題格式: ${item.title}`);
        return;
    }
    const chapterName = match[1]; // 如 "學而"
    const major = parseInt(match[2], 10); // 如 1
    if (isNaN(major) || major < 1 || major > 20) return; // 假設共 20 章

    if (!groupedChapters[major]) {
        // 存儲章名和子節列表
        groupedChapters[major] = { name: chapterName, chapters: [] };
    }
    groupedChapters[major].chapters.push(item);
  });

  // 按子節 ID 排序 (確保 1.1, 1.2, ... 順序)
   for (const major in groupedChapters) {
       groupedChapters[major].chapters.sort((a, b) => {
           const numA = parseFloat(a.title.match(/(\d+\.\d+)$/)[1]);
           const numB = parseFloat(b.title.match(/(\d+\.\d+)$/)[1]);
           return numA - numB;
       });
   }
}

// 渲染第一級目錄 (章名)
function renderChapterMenu() {
  if (!chapterMenuEl) return;
  chapterMenuEl.innerHTML = ""; // 清空

  const gridContainer = document.createElement("div");
  // CSS 中已設置 grid 樣式，此處無需再設 style

  // 按章號排序
  const sortedMajors = Object.keys(groupedChapters).map(Number).sort((a, b) => a - b);

  sortedMajors.forEach(major => {
    const chapterData = groupedChapters[major];
    const btn = document.createElement("button");
    btn.textContent = `${chapterData.name} (第 ${major} 章)`; // 顯示章名和章號
    btn.classList.add('ghibli-button'); // 添加樣式
    btn.onclick = (e) => {
      e.preventDefault(); // 阻止可能的默認行為
      renderSubChapterMenu(major);
      // 可選：點擊大章時，收起其他大章的子目錄
      // closeOtherSubMenus(major);
    };
    gridContainer.appendChild(btn);
  });
  chapterMenuEl.appendChild(gridContainer);
}

// 渲染第二級目錄 (子節號)
function renderSubChapterMenu(major) {
  // 確保 subChapterMenuEl 存在且正確附加到 DOM
  if (!subChapterMenuEl) {
    const container = document.getElementById('sub-chapter-menu-container');
    if (container) {
        subChapterMenuEl = container.querySelector('#sub-chapter-menu');
        if (!subChapterMenuEl) {
             subChapterMenuEl = document.createElement("nav");
             subChapterMenuEl.id = "sub-chapter-menu";
             container.appendChild(subChapterMenuEl);
        }
    } else {
        console.error("無法找到 #sub-chapter-menu-container");
        return;
    }
  }

  subChapterMenuEl.innerHTML = ""; // 清空現有子目錄

  const subChapters = groupedChapters[major]?.chapters;
  if (!subChapters || subChapters.length === 0) return;

  // CSS 中已設置 grid 樣式

  subChapters.forEach(item => {
    const a = document.createElement("a");
    a.href = "#"; // 保持 # 但阻止跳轉
    const match = item.title.match(/(\d+\.\d+)/);
    a.textContent = match ? match[1] : `ID:${item.id}`; // 顯示 x.y 格式
    a.classList.add('ghibli-button'); // 添加樣式
    // 添加 aria-role 和其他無障礙屬性可能更好
    a.onclick = (e) => {
      e.preventDefault(); // 阻止跳轉
      displayChapter(item.id);
    };
    subChapterMenuEl.appendChild(a);
  });
}

// 顯示指定 ID 的論語內容
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id == id); // 鬆散比較以防 id 是字符串
  if (!chapter) {
    console.error("找不到章節 id:", id);
    if(chapterContentEl) chapterContentEl.innerHTML = `<p>錯誤：找不到 ID 為 ${id} 的章節。</p>`;
    return;
  }
  currentAnalect = chapter; // 更新當前選中的論語

  if (chapterContentEl) {
    // 使用 <pre> 保留原始文本中的換行和空格，或用 <p> 配合 CSS white-space: pre-wrap;
    // 此處選擇 <p> 並依賴 CSS line-height 和 margin
    chapterContentEl.innerHTML = `<h2>${chapter.title}</h2><p>${chapter.text.replace(/\n/g, '<br>')}</p>`; // 將換行符轉為 <br>
  }

  // 重置互動狀態
  resetInteractionState();

  // 可選：標記閱讀和更新進度 (保持原樣)
  // markChapterAsViewed(id);
  // updateProgress();
}

// 重置對話狀態、按鈕文本和輸入框
function resetInteractionState() {
    conversationHistory = []; // 清空歷史
    currentInteractionType = null; // 清除互動類型
    isWaitingForAI = false; // 重置等待狀態
    if (messagesEl) messagesEl.innerHTML = ""; // 清空對話顯示區域
    if (userInputAreaEl) userInputAreaEl.style.display = "none"; // 隱藏輸入框
    if (userInputEl) userInputEl.value = ""; // 清空輸入框內容
    // 恢復按鈕的默認文本
    if (btnYangEl) btnYangEl.textContent = "楊伯峻「論語譯註」";
    if (btnGeminiEl) btnGeminiEl.textContent = "Gemini 解讀";
    // 確保按鈕可點擊
    enableInteractionButtons();
}

// 啟用交互按鈕
function enableInteractionButtons() {
    if (btnYangEl) btnYangEl.disabled = false;
    if (btnGeminiEl) btnGeminiEl.disabled = false;
    if (sendInputBtnEl) sendInputBtnEl.disabled = false;
    isWaitingForAI = false; // 確保等待標誌解除
}

// 禁用交互按鈕（防止 AI 處理時重複點擊）
function disableInteractionButtons() {
    if (btnYangEl) btnYangEl.disabled = true;
    if (btnGeminiEl) btnGeminiEl.disabled = true;
    if (sendInputBtnEl) sendInputBtnEl.disabled = true;
    isWaitingForAI = true; // 設置等待標誌
}

/* ========== AI 互動相關函式 ========== */

// 格式化文本，保留換行和段落
function formatMessageText(text) {
    if (!text) return "";
    // 1. 將連續的兩個或多個換行符替換為標記，以便創建段落
    // 2. 將單個換行符替換為 <br>
    // 3. 將標記替換回 </p><p>
    // 4. 包裹在 <p> 中
    const paragraphs = text.split(/\n\s*\n+/); // 按空行分割成段落
    return paragraphs.map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('');
}

// 向對話框添加消息
function addMessage(messageText, sender = "system", isError = false) {
  if (!messagesEl) return;

  const messageContainer = document.createElement("div");
  messageContainer.classList.add("message-container", sender); // 'user', 'ai', 'confucius', 'system'
  if (isError) messageContainer.style.color = 'red'; // 簡單錯誤樣式

  // 處理 loading 消息的特殊 class
  if (sender === 'loading') {
      messageContainer.classList.add('loading-message');
      messageContainer.innerHTML = `<p>${messageText}</p>`; // Loading 消息一般較短，直接用p
  } else {
      messageContainer.innerHTML = formatMessageText(messageText); // 使用格式化函數
  }

  messagesEl.appendChild(messageContainer);
  // 自動滾動到底部
  messagesEl.scrollTop = messagesEl.scrollHeight;

  // 如果不是 loading 消息，添加到歷史記錄 (結構化)
  if (sender !== 'loading') {
      conversationHistory.push({ role: sender, content: messageText });
  }
  return messageContainer; // 返回創建的元素，方便後續移除 loading
}

// 將對話歷史格式化為字符串，供 AI prompt 使用
function formatHistoryForAI(history) {
    return history.map(msg => {
        let roleName = msg.role;
        if (roleName === 'confucius' || roleName === 'ai') roleName = '孔子';
        else if (roleName === 'user') roleName = '用戶';
        else roleName = '系統'; // 或省略系統消息
        return `${roleName}：\n${msg.content}`;
    }).join('\n\n'); // 使用雙換行分隔不同角色/回合
}

// 調用 Cloudflare Worker AI
function askGemini(prompt, callback) {
  if (isWaitingForAI) {
      console.log("AI is already processing a request.");
      return; // 防止重複調用
  }
  disableInteractionButtons(); // 禁用按鈕

  let loadingMessageElement = addMessage("正在思考中，請稍候...", 'loading'); // 顯示 loading

  fetch(CLOUD_FLARE_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(response => {
        if (!response.ok) {
            // 嘗試讀取錯誤信息
            return response.json().then(errData => {
                 throw new Error(`AI請求失敗 (${response.status}): ${errData.error || response.statusText}`);
            }).catch(() => {
                // 如果讀取json失敗，拋出通用錯誤
                throw new Error(`AI請求失敗 (${response.status}): ${response.statusText}`);
            });
        }
        return response.json();
    })
    .then(data => {
      if (loadingMessageElement) messagesEl.removeChild(loadingMessageElement); // 移除 loading
      enableInteractionButtons(); // 啟用按鈕
      callback(data.answer || "AI 未能提供有效回答。", false); // false 表示非錯誤
    })
    .catch(error => {
      console.error("AI 請求失敗：", error);
      if (loadingMessageElement) messagesEl.removeChild(loadingMessageElement); // 移除 loading
      enableInteractionButtons(); // 啟用按鈕
      callback(`唉，思緒略有阻塞，未能回應。(${error.message})`, true); // true 表示是錯誤
    });
}


// 孔子語氣指令
const confuciusPersonaInstruction = "你現在扮演中國古代的聖人孔子。請使用文雅、古典、蘊含哲理的語言風格回答問題，如同《論語》中的口吻。稱呼提問者為“汝”或“君”。論述時，務必旁徵博引，結合《論語》全文思想及歷代注疏（如集解、正義、集注等）精髓。避免使用現代網絡用語或過於口語化的表達。回答需分點或分段，條理清晰。";

/* ========== 按鈕點擊處理 ========== */

// 處理點擊「楊伯峻「論語譯註」」按鈕
function handleYangAnnotationClick() {
  if (!currentAnalect || isWaitingForAI) return;

  resetInteractionState(); // 重置對話狀態
  currentInteractionType = 'yang'; // 設置當前互動類型

  const translation = currentAnalect.translation || "（暫無譯文）";
  const annotations = currentAnalect.annotations || "（暫無注釋）";

  // 1. 直接顯示譯文和注釋
  addMessage(`**${currentAnalect.title} - 譯文**\n${translation}`, 'confucius');
  addMessage(`**${currentAnalect.title} - 注釋**\n${annotations}`, 'confucius');

  // 2. 顯示提示信息，準備調用 AI
  addMessage("Gemini正在和你一起分析這則內容⋯耐個心吧 🐶⋯", 'loading'); // 使用 'loading' class

  // 3. 構建發送給 AI 的初始 Prompt
  const prompt = `${confuciusPersonaInstruction}\n\n吾觀此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文：${translation}\n註疏：${annotations}\n\n請基於《論語》全文思想及歷代注疏，對此章進行深入分析，闡述其微言大義。`;

  // 4. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      if (!isError) {
          addMessage(aiAnswer, 'confucius');
          // 5. 更改按鈕文本並顯示輸入框
          if (btnYangEl) btnYangEl.textContent = "深度對話 (楊伯峻)";
          if (userInputAreaEl) userInputAreaEl.style.display = "flex"; // 顯示輸入框
          if (userInputEl) userInputEl.focus(); // 自動聚焦
      } else {
          addMessage(aiAnswer, 'system', true); // 顯示錯誤信息
          resetInteractionState(); // 出錯則重置
      }
  });
}

// 處理點擊「Gemini 解讀」按鈕
function handleGeminiAnalysisClick() {
  if (!currentAnalect || isWaitingForAI) return;

  resetInteractionState(); // 重置對話狀態
  currentInteractionType = 'gemini'; // 設置當前互動類型

  // 1. 顯示加載提示
  addMessage("Gemini正在思考歷代解說⋯請稍候...", 'loading');

  // 2. 構建發送給 AI 的 Prompt
  const prompt = `${confuciusPersonaInstruction}\n\n針對此章 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n\n請基於《論語》全文及歷代注疏、集解、正義、箋注等，詳盡列舉此章的歷代重要解說，尤其需呈現不同學派或觀點之異同。比較各家說法後，請選擇一說，闡明汝（AI）之所取及其緣由。`;

  // 3. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      if (!isError) {
          addMessage(aiAnswer, 'confucius');
          // 4. 更改按鈕文本並顯示輸入框
          if (btnGeminiEl) btnGeminiEl.textContent = "深度對話 (Gemini)";
           if (userInputAreaEl) userInputAreaEl.style.display = "flex";
           if (userInputEl) userInputEl.focus();
      } else {
          addMessage(aiAnswer, 'system', true); // 顯示錯誤信息
          resetInteractionState(); // 出錯則重置
      }
  });
}

// 處理用戶輸入
function handleUserInput() {
  if (!userInputEl || isWaitingForAI) return;
  const userText = userInputEl.value.trim();
  if (!userText) return; // 不發送空消息

  if (!currentInteractionType) {
      addMessage("請先選擇一個對話主題（“楊伯峻譯註”或“Gemini解讀”）。", "system", true);
      return;
  }

  // 1. 將用戶消息添加到顯示區和歷史記錄
  addMessage(userText, 'user');
  userInputEl.value = ""; // 清空輸入框

  // 2. 構建包含歷史記錄和指令的 Prompt
  const historyString = formatHistoryForAI(conversationHistory);
  let prompt = "";

  if (currentInteractionType === 'yang') {
      prompt = `${confuciusPersonaInstruction}\n\n當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n譯文與注釋已閱。\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請繼續以孔子身份，針對用戶最新提問進行回應 ---`;
  } else if (currentInteractionType === 'gemini') {
      prompt = `${confuciusPersonaInstruction}\n\n當前討論之章節 (${currentAnalect.title}):\n原文：${currentAnalect.text}\n歷代解說已閱。\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請繼續以孔子身份，針對用戶最新提問進行回應 ---`;
  } else {
      // 理論上不應執行到這裡
      prompt = `${confuciusPersonaInstruction}\n\n--- 對話歷史 ---\n${historyString}\n\n--- 請以孔子身份回應 ---`;
  }

  // 3. 調用 AI
  askGemini(prompt, (aiAnswer, isError) => {
      addMessage(aiAnswer, isError ? 'system' : 'confucius', isError);
      // AI 回答後，輸入框保持顯示，等待用戶繼續輸入
       if (userInputEl && !isError) userInputEl.focus(); // 成功後重新聚焦
  });
}


/* ========== 其他功能 ========== */

// 切換目錄顯示/隱藏
function toggleMenu() {
    if (!chapterMenuEl || !toggleMenuBtnEl) return;
    if (chapterMenuEl.style.display === "none") {
      chapterMenuEl.style.display = "block";
      // 確保子目錄容器也顯示（如果之前被隱藏）
       const subMenuContainer = document.getElementById('sub-chapter-menu-container');
       if (subMenuContainer) subMenuContainer.style.display = 'block';
       toggleMenuBtnEl.textContent = "隱藏目錄";
    } else {
      chapterMenuEl.style.display = "none";
      // 同時隱藏子目錄容器
      const subMenuContainer = document.getElementById('sub-chapter-menu-container');
      if (subMenuContainer) subMenuContainer.style.display = 'none';
      toggleMenuBtnEl.textContent = "顯示目錄";
    }
}

// 切換夜晚模式
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  // 可選：將偏好存儲到 localStorage
  if (document.body.classList.contains("dark-mode")) {
      localStorage.setItem("darkMode", "enabled");
  } else {
      localStorage.setItem("darkMode", "disabled");
  }
}

// 頁面加載時檢查並應用夜晚模式偏好
function applyDarkModePreference() {
    if (localStorage.getItem("darkMode") === "enabled") {
        document.body.classList.add("dark-mode");
    }
}

// --- Legacy Functions (保留用於可能的進度顯示) ---
function markChapterAsViewed(id) {
  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  if (!viewed.includes(String(id))) { // 確保存儲為字符串
    viewed.push(String(id));
    localStorage.setItem("viewedChapters", JSON.stringify(viewed));
  }
}

function updateProgress() {
  // 假設總數是 allChapters.length
  const totalCount = allChapters.length;
  if (totalCount === 0) return; // 防止除以零

  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  const percent = Math.round((viewed.length / totalCount) * 100);
  const progressEl = document.getElementById("progress"); // 需要在 HTML 中添加 <div id="progress"></div>
  if (progressEl) {
    progressEl.textContent = `閱讀進度：${viewed.length} / ${totalCount} (${percent}%)`;
  }
}


// --- 初始化 ---
document.addEventListener("DOMContentLoaded", () => {
    applyDarkModePreference(); // 先應用暗色模式
    loadDialogues();         // 然後加載數據並初始化
});
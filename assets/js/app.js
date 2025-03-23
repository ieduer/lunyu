const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev/";

// 用於存放「目前隨機抽到」的那條論語內容
let currentAnalect = null;
// 全部數據存放
let allChapters = [];
// 分組後的第一級目錄：key 為大章號 (1~20)，值為對應的子節陣列
let groupedChapters = {};

/* ========== 數據載入與目錄生成 ========== */
function loadDialogues() {
  fetch("data/dialogues.json")
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) {
        console.error("dialogues.json 資料格式有誤或為空");
        return;
      }
      allChapters = data;
      groupChapters();
      renderChapterMenu();
      // 預設顯示隨機一個子節
      const randomIndex = Math.floor(Math.random() * data.length);
      displayChapter(data[randomIndex].id);
    })
    .catch(err => console.error("讀取 dialogues.json 出錯：", err));
}

// 根據每個項目的 title 解析大章號並分組
function groupChapters() {
  groupedChapters = {};
  allChapters.forEach(item => {
    // 假設 title 格式含有 "x.y"，例如 "學而 1.1" 或 "20.3"
    const match = item.title.match(/(\d+)\.(\d+)/);
    if (!match) return;
    const major = parseInt(match[1], 10);
    // 只取 1~20 章
    if (major < 1 || major > 20) return;
    if (!groupedChapters[major]) groupedChapters[major] = [];
    groupedChapters[major].push(item);
  });
}

// 渲染第一級目錄 (1~20 章) 以 CSS Grid 呈現（由 style.css 控制網格）
function renderChapterMenu() {
  const menu = document.getElementById("chapter-menu");
  if (!menu) return;
  menu.innerHTML = ""; // 清空目錄

  // 創建第一級目錄容器，使用 grid 排列
  const gridContainer = document.createElement("div");
  gridContainer.style.display = "grid";
  gridContainer.style.gridTemplateColumns = "repeat(5, 1fr)";
  gridContainer.style.gridAutoRows = "auto";
  gridContainer.style.gap = "0.5rem";

  for (let i = 1; i <= 20; i++) {
    if (!groupedChapters[i] || groupedChapters[i].length === 0) continue;
    const btn = document.createElement("button");
    btn.textContent = `第 ${i} 章`;
    btn.style.width = "100%";
    // 點擊後展開對應的第二級目錄
    btn.onclick = () => {
      renderSubChapterMenu(i);
      return false;
    };
    gridContainer.appendChild(btn);
  }
  menu.appendChild(gridContainer);
}

// 渲染第二級目錄：點選某一章後，顯示該章所有子節
function renderSubChapterMenu(major) {
  let subMenuContainer = document.getElementById("sub-chapter-menu");
  if (!subMenuContainer) {
    // 若不存在，動態創建並附加到 chapter-menu 之後
    subMenuContainer = document.createElement("div");
    subMenuContainer.id = "sub-chapter-menu";
    subMenuContainer.style.marginTop = "1rem";
    document.getElementById("chapter-menu").appendChild(subMenuContainer);
  }
  subMenuContainer.innerHTML = ""; // 清空現有子目錄

  const subChapters = groupedChapters[major];
  if (!subChapters || subChapters.length === 0) return;

  // 每列最多 5 個，計算需要的列數由 CSS Grid 自動控制
  subMenuContainer.style.display = "grid";
  subMenuContainer.style.gridTemplateColumns = "repeat(5, 1fr)";
  subMenuContainer.style.gap = "0.5rem";

  subChapters.forEach(item => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = `ID: ${item.id}`;
    a.style.display = "block";
    a.style.textAlign = "center";
    a.style.padding = "0.3rem";
    a.style.border = "1px solid #ddd";
    a.style.borderRadius = "3px";
    a.style.textDecoration = "none";
    a.style.color = "#0077cc";
    a.onclick = () => {
      displayChapter(item.id);
      return false;
    };
    subMenuContainer.appendChild(a);
  });
}

// 將指定 id 的論語內容顯示到章節內容區 (#chapter-content)
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id == id); // 使用鬆散比較
  if (!chapter) {
    console.error("找不到章節 id:", id);
    return;
  }
  currentAnalect = chapter;
  const chapterContent = document.getElementById("chapter-content");
  if (chapterContent) {
    chapterContent.innerHTML = `<h2>${chapter.title}</h2><p>${chapter.text}</p>`;
  }
  markChapterAsViewed(id);
  updateProgress();
}

// 標記已閱讀章節
function markChapterAsViewed(id) {
  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  if (!viewed.includes(id)) {
    viewed.push(id);
    localStorage.setItem("viewedChapters", JSON.stringify(viewed));
  }
}

// 更新進度 (假設總共 20 章)
function updateProgress() {
  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  const percent = Math.round((viewed.length / 20) * 100);
  const progressEl = document.getElementById("progress");
  if (progressEl) {
    progressEl.textContent = `進度：${percent}%`;
  }
}

/* ========== AI 互動相關函式 ========== */
function askGemini(prompt, callback) {
  fetch(CLOUD_FLARE_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(response => response.json())
    .then(data => {
      callback(data.answer);
    })
    .catch(error => {
      console.error("AI 請求失敗：", error);
      callback("抱歉，AI 回答出錯。");
    });
}

function addMessage(message, sender = "system") {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  const div = document.createElement("div");
  div.className = sender;
  div.innerHTML = message; // 使用 innerHTML 支援格式化內容
  messagesEl.appendChild(div);
}

function formatAnswer(text) {
  // 將文字以換行符拆分，並用 <p> 包裹每一段
  return text.split('\n').map(line => `<p>${line.trim()}</p>`).join('');
}

function sendChoice(choice) {
  if (!currentAnalect) {
    addMessage("尚未載入任何論語內容，請稍後再試。", "system");
    return;
  }
  if (choice === 1) {
    const explanation = `譯文：${currentAnalect.translation || "（無譯文）"}\n\n注釋：${currentAnalect.annotations || "（無注釋）"}`;
    addMessage(formatAnswer(explanation), "孔子");
  } else if (choice === 2) {
    addMessage("Gemini AI：正在生成現代解讀……", "ai");
    const prompt = `請用現代觀念剖析以下論語內容：\n${currentAnalect.text}`;
    askGemini(prompt, function(aiAnswer) {
      addMessage("Gemini AI：" + formatAnswer(aiAnswer), "ai");
    });
  }
}

function showInput() {
  const customInputEl = document.getElementById("custom-input");
  if (customInputEl) {
    customInputEl.style.display = "flex";
    customInputEl.style.flexDirection = "column";
  }
}

function sendCustomQuestion() {
  const input = document.getElementById("userQuestion");
  if (!input || !input.value.trim()) return;
  const question = input.value.trim();
  addMessage("你：" + question, "user");
  const prompt = `當前論語：${currentAnalect.text}\n用戶問題：${question}`;
  askGemini(prompt, function(aiAnswer) {
    addMessage("Gemini AI：" + formatAnswer(aiAnswer), "ai");
  });
  input.value = "";
  document.getElementById("custom-input").style.display = "none";
}

document.addEventListener("DOMContentLoaded", loadDialogues);

document.addEventListener("DOMContentLoaded", () => {
  const toggleMenuBtn = document.getElementById("toggle-menu-btn");
  const chapterMenu = document.getElementById("chapter-menu");

  // 切換顯示/隱藏目錄
  toggleMenuBtn.addEventListener("click", () => {
    if (chapterMenu.style.display === "none") {
      chapterMenu.style.display = "block";
      toggleMenuBtn.textContent = "隱藏目錄";
    } else {
      chapterMenu.style.display = "none";
      toggleMenuBtn.textContent = "顯示目錄";
    }
  });
});
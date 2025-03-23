// 請改成你自己的 Cloudflare Worker 網址
const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev/";

let currentAnalect = null;   // 用於存放「目前選中的論語」
let allChapters = [];        // 全部數據
let groupedChapters = {};    // 按章(1~20)分組後的資料

/****************************************************
 *  載入 & 分組資料
 ****************************************************/
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
      renderChapterMenu();        // 渲染第一級目錄
      // 預設顯示隨機一個子節
      const randomIndex = Math.floor(Math.random() * data.length);
      displayChapter(data[randomIndex].id);
    })
    .catch(err => console.error("讀取 dialogues.json 出錯：", err));
}

// 按 title 中的 "x.y" 格式解析大章號(1~20)，並分組
function groupChapters() {
  groupedChapters = {};
  allChapters.forEach(item => {
    const match = item.title.match(/(\d+)\.(\d+)/);
    if (!match) return;
    const major = parseInt(match[1], 10);
    if (major < 1 || major > 20) return;
    if (!groupedChapters[major]) groupedChapters[major] = [];
    groupedChapters[major].push(item);
  });
}

/****************************************************
 *  第一級目錄 (1~20 章)
 ****************************************************/
function renderChapterMenu() {
  const menu = document.getElementById("chapter-menu");
  if (!menu) return;
  // 先清空，避免重複渲染
  menu.innerHTML = "";

  // 創建第一級容器
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
    btn.onclick = () => {
      // 點擊後隱藏第一級目錄，顯示該章的子目錄
      menu.style.display = "none";
      renderSubChapterMenu(i);
      return false;
    };
    gridContainer.appendChild(btn);
  }
  menu.appendChild(gridContainer);
}

/****************************************************
 *  第二級目錄：只顯示所點章節的子節
 ****************************************************/
function renderSubChapterMenu(major) {
  // 若先前有子目錄容器，先移除避免重複
  let subMenuContainer = document.getElementById("sub-chapter-menu");
  if (subMenuContainer) {
    subMenuContainer.remove();
  }
  // 新建子目錄容器
  subMenuContainer = document.createElement("div");
  subMenuContainer.id = "sub-chapter-menu";
  subMenuContainer.style.marginTop = "1rem";

  const parentMenu = document.getElementById("chapter-menu");
  // 放在第一級目錄後面 (同層)
  parentMenu.insertAdjacentElement("afterend", subMenuContainer);

  // 加一個返回按鈕
  const backBtn = document.createElement("button");
  backBtn.textContent = "返回章列表";
  backBtn.style.marginBottom = "1rem";
  backBtn.onclick = () => {
    // 移除子目錄容器，並重新顯示第一級目錄
    subMenuContainer.remove();
    parentMenu.style.display = "block";
  };
  subMenuContainer.appendChild(backBtn);

  // 取出該章的所有子節
  const subChapters = groupedChapters[major];
  if (!subChapters || subChapters.length === 0) return;

  // 使用 grid 佈局，每列最多 5 個
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(5, 1fr)";
  grid.style.gap = "0.5rem";

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
    grid.appendChild(a);
  });

  subMenuContainer.appendChild(grid);
}

/****************************************************
 *  顯示章節內容
 ****************************************************/
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id == id);
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

function markChapterAsViewed(id) {
  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  if (!viewed.includes(id)) {
    viewed.push(id);
    localStorage.setItem("viewedChapters", JSON.stringify(viewed));
  }
}

function updateProgress() {
  let viewed = JSON.parse(localStorage.getItem("viewedChapters")) || [];
  const percent = Math.round((viewed.length / 20) * 100);
  const progressEl = document.getElementById("progress");
  if (progressEl) {
    progressEl.textContent = `進度：${percent}%`;
  }
}

/****************************************************
 *  AI 互動相關函式
 ****************************************************/
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
  div.innerHTML = message;
  messagesEl.appendChild(div);
}

function formatAnswer(text) {
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
    const prompt = `請用現代語言解讀以下論語內容：\n${currentAnalect.text}`;
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

/****************************************************
 *  啟動程式：載入數據 + 綁定事件
 ****************************************************/
document.addEventListener("DOMContentLoaded", () => {
  // 先載入 dialogues.json
  loadDialogues();

  // 切換顯示/隱藏第一級目錄
  const toggleMenuBtn = document.getElementById("toggle-menu-btn");
  const chapterMenu = document.getElementById("chapter-menu");
  if (toggleMenuBtn && chapterMenu) {
    toggleMenuBtn.addEventListener("click", () => {
      if (chapterMenu.style.display === "none") {
        chapterMenu.style.display = "block";
        toggleMenuBtn.textContent = "隱藏目錄";
      } else {
        chapterMenu.style.display = "none";
        toggleMenuBtn.textContent = "顯示目錄";
      }
    });
  }
});
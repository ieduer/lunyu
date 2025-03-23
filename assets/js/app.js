// 請改成你自己的 Cloudflare Worker 網址
const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev/";

// 用於存放「目前隨機抽到」的那條論語內容
let currentAnalect = null;

// ========== 隨機顯示一條論語 ========== //
function loadRandomAnalect() {
  fetch("data/dialogues.json")
    .then(response => response.json())
    .then(data => {
      if (!Array.isArray(data) || data.length === 0) {
        console.error("dialogues.json 資料格式有誤，或是空的。");
        return;
      }
      // 隨機挑一條
      const randomIndex = Math.floor(Math.random() * data.length);
      const item = data[randomIndex];
      // 記錄在全域變數 currentAnalect
      currentAnalect = item;

      // 顯示在網頁上 (初始隨機論語)
      const randomTextEl = document.getElementById("random-text");
      if (randomTextEl) {
        randomTextEl.textContent = item.text || "（本條論語無正文）";
      }
    })
    .catch(err => {
      console.error("讀取 dialogues.json 發生錯誤：", err);
    });
}

// ========== 啟動程式 ========== //
document.addEventListener("DOMContentLoaded", () => {
  loadDialogues();
});

// ========== AI 互動邏輯 ========== //
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

// ========== 對話顯示相關函式 ========== //
function addMessage(message, sender = "system") {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  const div = document.createElement("div");
  div.className = sender;
  // 使用 innerHTML 以支持分段的 HTML 格式（例如 <p> 標籤）
  div.innerHTML = message;
  messagesEl.appendChild(div);
}

// ========== 分段格式化函式 ========== //
function formatAnswer(text) {
  // 將文字以換行符拆分，並用 <p> 包裹每一段
  return text.split('\n').map(line => `<p>${line.trim()}</p>`).join('');
}

// ========== 按鈕點擊行為 ========== //
function sendChoice(choice) {
  if (!currentAnalect) {
    addMessage("尚未載入任何論語內容，請稍後再試。", "system");
    return;
  }

  if (choice === 1) {
    // 顯示譯文與注釋，並使用 formatAnswer() 分段處理
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
    customInputEl.style.display = "block";
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

// ========== 目錄與章節顯示相關函式 ========== //
function renderChapterMenu(data) {
  const menu = document.getElementById("chapter-menu");
  menu.innerHTML = ""; // 清空現有目錄
  data.forEach(chapter => {
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = chapter.title;
    link.onclick = () => {
      displayChapter(chapter.id);
      return false;
    };
    menu.appendChild(link);
  });
}

let allChapters = []; // 全部章節數據
function displayChapter(id) {
  const chapter = allChapters.find(ch => ch.id === id);
  if (!chapter) return;
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
  document.getElementById("progress").textContent = `進度：${percent}%`;
}

function loadDialogues() {
  fetch("data/dialogues.json")
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data)) {
        console.error("dialogues.json 格式不正確");
        return;
      }
      allChapters = data;
      renderChapterMenu(data);
      // 預設顯示隨機章節
      const randomIndex = Math.floor(Math.random() * data.length);
      displayChapter(data[randomIndex].id);
    })
    .catch(err => console.error("讀取 dialogues.json 出錯：", err));
}

document.addEventListener("DOMContentLoaded", loadDialogues);
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

      // 顯示在網頁上
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
  // 載入並顯示隨機論語
  loadRandomAnalect();
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
  div.textContent = message;
  messagesEl.appendChild(div);
}

// ========== 按鈕點擊行為 ========== //
function sendChoice(choice) {
  // 若尚未載入任何論語，提示用戶
  if (!currentAnalect) {
    addMessage("尚未載入任何論語內容，請稍後再試。", "system");
    return;
  }

  if (choice === 1) {
    // 「孔子：我該如何解釋這句？」 => 顯示譯文與注釋
    const explanation = `譯文：${currentAnalect.translation || "（無譯文）"}\n\n注釋：${currentAnalect.annotations || "（無注釋）"}`;
    addMessage(explanation, "孔子");
  } else if (choice === 2) {
    // 「Gemini AI：請給我現代解讀」 => 呼叫 AI，並把正文帶入 Prompt
    addMessage("Gemini AI：正在生成現代解讀……", "ai");
    const prompt = `請用現代語言解讀以下論語內容：\n${currentAnalect.text}`;
    askGemini(prompt, function(aiAnswer) {
      addMessage("Gemini AI：" + aiAnswer, "ai");
    });
  }
}

function formatAnswer(text) {
  // 以換行符分段，並包裹在 <p> 標籤內
  return text.split('\n').map(line => `<p>${line.trim()}</p>`).join('');
}

// 自由提問：將用戶問題 + 當前論語正文一併傳給 AI
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
  // 將當前論語正文也加入 Prompt
  const prompt = `當前論語：${currentAnalect.text}\n用戶問題：${question}`;
  askGemini(prompt, function(aiAnswer) {
    addMessage("Gemini AI：" + aiAnswer, "ai");
  });

  input.value = "";
  document.getElementById("custom-input").style.display = "none";
}

function renderChapterMenu(data) {
  const menu = document.getElementById("chapter-menu");
  menu.innerHTML = ""; // 清空現有目錄
  data.forEach(chapter => {
    // 建立章節連結，點擊後調用 displayChapter(chapter.id)
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = chapter.title;
    link.onclick = () => {
      displayChapter(chapter.id);
      return false; // 阻止預設行為
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
    // 顯示正文（可擴充顯示譯文和注釋）
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
      allChapters = data; // 保存到全域變數
      renderChapterMenu(data);
      // 預設顯示隨機章節
      const randomIndex = Math.floor(Math.random() * data.length);
      displayChapter(data[randomIndex].id);
    })
    .catch(err => console.error("讀取 dialogues.json 出錯：", err));
}

document.addEventListener("DOMContentLoaded", loadDialogues);
// Worker 交互函式（保持原有邏輯）
function askGemini(prompt, callback) {
  // 這裡請將 WORKER_URL 修改為你部署後的 Worker 網址
  fetch("https://lunyu.bdfz.workers.dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  })
    .then(response => response.json())
    .then(data => callback(data.answer))
    .catch(error => {
      console.error(error);
      callback("抱歉，AI 回答出錯。");
    });
}

// 格式化 AI 回覆，按換行分段
function formatAnswer(text) {
  return text.split('\n').map(line => `<p>${line.trim()}</p>`).join('');
}

// 多輪對話歷史保存（簡單示例）
let conversationHistory = [];

// 建立包含對話上下文的 prompt
function buildPrompt(newQuestion, chapterText) {
  let context = `當前章節：${chapterText}\n`;
  conversationHistory.forEach(msg => {
    context += msg.role === 'user' ? `用戶：${msg.content}\n` : `AI：${msg.content}\n`;
  });
  context += `用戶：${newQuestion}\n請根據以上對話和章節內容回答。`;
  return context;
}

// 加載論語數據，隨機選章，生成目錄與進度
let analectsData = [];
function loadAnalects() {
  fetch("data/analects.json")
    .then(res => res.json())
    .then(data => {
      analectsData = data;
      renderChapterMenu();
      displayRandomChapter();
      updateProgress();
    })
    .catch(err => console.error(err));
}

function renderChapterMenu() {
  const menu = document.getElementById("chapter-menu");
  menu.innerHTML = "";
  analectsData.forEach(chapter => {
    const a = document.createElement("a");
    a.href = "#";
    a.innerText = chapter.title;
    a.onclick = () => displayChapter(chapter.id);
    menu.appendChild(a);
  });
}

function displayRandomChapter() {
  if (analectsData.length === 0) return;
  const random = analectsData[Math.floor(Math.random() * analectsData.length)];
  displayChapter(random.id);
}

function displayChapter(id) {
  const chapter = analectsData.find(ch => ch.id === id);
  if (!chapter) return;
  document.getElementById("chapter-content").innerHTML =
    `<h2>${chapter.title}</h2>` +
    `<div class="text">${chapter.text}</div>` +
    `<div class="annotations">${chapter.annotations}</div>`;
  // 更新進度記錄
  markChapterAsViewed(id);
  updateProgress();
  // 重置對話歷史
  conversationHistory = [];
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
  const percent = Math.round((viewed.length / analectsData.length) * 100);
  document.getElementById("progress").innerText = `進度：${percent}%`;
}

// 前端互動函式（與 Worker 交互）
function sendChoice(choice) {
  // 這裡根據 choice 處理不同的情景
  if (choice === 1) {
    // 例如：展示預設回覆（模擬孔子回答）
    addMessage("孔子：善哉！溫習所學，方能持續進步。", "孔子");
  } else if (choice === 2) {
    // 由 Gemini AI 回覆，傳送當前章節作為上下文
    const chapterText = document.querySelector("#chapter-content .text").innerText;
    const promptText = buildPrompt("請給我現代解讀", chapterText);
    addMessage("Gemini AI：正在生成現代解讀……", "ai");
    askGemini(promptText, function(answer) {
      addMessage(formatAnswer(answer), "ai");
      // 保存到對話歷史
      conversationHistory.push({ role: "assistant", content: answer });
    });
  }
}

function showInput() {
  document.getElementById("custom-input").style.display = "block";
}

function sendCustomQuestion() {
  const input = document.getElementById("userQuestion");
  if (!input.value.trim()) return;
  const newQuestion = input.value.trim();
  addMessage(`你：${newQuestion}`, "user");
  // 保存到對話歷史
  conversationHistory.push({ role: "user", content: newQuestion });
  const chapterText = document.querySelector("#chapter-content .text").innerText;
  const promptText = buildPrompt(newQuestion, chapterText);
  askGemini(promptText, function(answer) {
    addMessage(formatAnswer(answer), "ai");
    conversationHistory.push({ role: "assistant", content: answer });
  });
  input.value = "";
  document.getElementById("custom-input").style.display = "none";
}

// 將訊息加入對話區
function addMessage(message, sender) {
  const messagesEl = document.getElementById("messages");
  const div = document.createElement("div");
  div.className = sender;
  div.innerHTML = message;
  messagesEl.appendChild(div);
}

// 初始化
document.addEventListener("DOMContentLoaded", loadAnalects);
// assets/js/app.js
const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev";

const dialogues = {
  // 這裡特別使用單引號包住中文引號，以免混淆
  text: '子曰：「學而時習之，不亦說乎？」',
  responses: {
    1: "孔子：善哉！溫習所學，方能持續進步。",
    2: "Gemini AI：正在生成現代解讀……"
  }
};

// 1. 顯示論語原文
const analectsTextEl = document.getElementById("analects-text");
if (analectsTextEl) {
  analectsTextEl.innerHTML = `<p>${dialogues.text}</p>`;
}

// 2. 添加訊息輔助函式
function addMessage(message, sender = "system") {
  const messagesContainer = document.getElementById("messages");
  if (!messagesContainer) return;
  const messageDiv = document.createElement("div");
  messageDiv.className = sender;
  messageDiv.textContent = message;
  messagesContainer.appendChild(messageDiv);
}

// 3. 將函式掛到 window，以便 inline onclick 能呼叫
window.sendChoice = function(choice) {
  if (choice === 1) {
    addMessage(dialogues.responses[1], "孔子");
  } else if (choice === 2) {
    addMessage(dialogues.responses[2], "ai");
    askGemini("請用現代語言解讀以下論語內容：" + dialogues.text, function(aiAnswer) {
      addMessage("Gemini AI：" + aiAnswer, "ai");
    });
  }
};

window.showInput = function() {
  const customInputEl = document.getElementById("custom-input");
  if (customInputEl) customInputEl.style.display = "block";
};

window.sendCustomQuestion = function() {
  const questionInput = document.getElementById("userQuestion");
  if (!questionInput) return;
  const question = questionInput.value.trim();
  if (!question) return;

  addMessage("你：" + question, "user");
  askGemini(question, function(aiAnswer) {
    addMessage("Gemini AI：" + aiAnswer, "ai");
  });

  const customInputEl = document.getElementById("custom-input");
  if (customInputEl) customInputEl.style.display = "none";
  questionInput.value = "";
};

// 4. 調用 Worker 代理 Gemini AI
function askGemini(prompt, callback) {
  fetch(CLOUD_FLARE_WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: prompt })
  })
    .then((response) => response.json())
    .then((data) => {
      callback(data.answer);
    })
    .catch((error) => {
      console.error(error);
      callback("抱歉，AI 回答出錯。");
    });
}
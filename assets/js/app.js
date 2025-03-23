// assets/js/app.js

// 設定 Cloudflare Worker 的代理域名（請替換為你自己的 Worker 域名）
const CLOUD_FLARE_WORKER_URL = 'https://lunyu.bdfz.workers.dev';

// 預設對話資料
const dialogues = {
  text: "子曰：「學而時習之，不亦說乎？」",
  responses: {
    // 孔子的預設幽默回答
    1: "孔子：善哉！溫習所學，方能持續進步。",
    // Gemini AI 的提示（實際回應由 Worker 轉發的 AI API 返回）
    2: "Gemini AI：正在生成現代解讀……"
  }
};

// 1. 顯示論語原文
const analectsTextEl = document.getElementById('analects-text');
if (analectsTextEl) {
  analectsTextEl.innerHTML = `<p>${dialogues.text}</p>`;
}

// 2. 在訊息區添加訊息的輔助函式
function addMessage(message, sender = 'system') {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;
  const messageDiv = document.createElement('div');
  messageDiv.className = sender;
  messageDiv.textContent = message;
  messagesContainer.appendChild(messageDiv);
}

// 3. 將原本的函式掛到 window，以便 HTML inline onclick 能呼叫

// (a) 根據玩家選項處理回應
window.sendChoice = function(choice) {
  if (choice === 1) {
    // 顯示孔子的預設回答
    addMessage(dialogues.responses[choice], '孔子');
  } else if (choice === 2) {
    // 顯示提示後呼叫 Gemini AI 進行現代解讀
    addMessage(dialogues.responses[choice], 'ai');
    askGemini("請用現代語言解讀以下論語內容：" + dialogues.text, function(aiAnswer) {
      addMessage("Gemini AI：" + aiAnswer, 'ai');
    });
  }
};

// (b) 顯示自訂提問輸入區
window.showInput = function() {
  const customInputEl = document.getElementById('custom-input');
  if (customInputEl) {
    customInputEl.style.display = 'block';
  }
};

// (c) 處理玩家自訂提問
window.sendCustomQuestion = function() {
  const questionInput = document.getElementById('userQuestion');
  if (!questionInput) return;

  const question = questionInput.value.trim();
  if (!question) return;

  addMessage("你：" + question, 'user');
  askGemini(question, function(aiAnswer) {
    addMessage("Gemini AI：" + aiAnswer, 'ai');
  });

  const customInputEl = document.getElementById('custom-input');
  if (customInputEl) customInputEl.style.display = 'none';
  questionInput.value = "";
};

// 4. 調用 Cloudflare Worker 代理 Gemini AI API
function askGemini(prompt, callback) {
  fetch(CLOUD_FLARE_WORKER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt: prompt })
  })
  .then(response => response.json())
  .then(data => {
    callback(data.answer);
  })
  .catch(error => {
    console.error(error);
    callback("抱歉，AI 回答出錯。");
  });
}
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

// 將論語原文顯示於頁面上
document.getElementById('analects-text').innerHTML = `<p>${dialogues.text}</p>`;

// 輔助函數：在訊息區添加訊息
function addMessage(message, sender = 'system') {
  const messageDiv = document.createElement('div');
  messageDiv.className = sender;
  messageDiv.textContent = message;
  document.getElementById('messages').appendChild(messageDiv);
}

// 根據玩家選項處理回應
function sendChoice(choice) {
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
}

// 顯示自訂提問輸入區
function showInput() {
  document.getElementById('custom-input').style.display = 'block';
}

// 處理玩家自訂提問
function sendCustomQuestion() {
  const question = document.getElementById('userQuestion').value;
  if (!question) return;
  addMessage("你：" + question, 'user');
  askGemini(question, function(aiAnswer) {
    addMessage("Gemini AI：" + aiAnswer, 'ai');
  });
  document.getElementById('custom-input').style.display = 'none';
  document.getElementById('userQuestion').value = "";
}

// 調用 Cloudflare Worker 代理 Gemini AI API
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
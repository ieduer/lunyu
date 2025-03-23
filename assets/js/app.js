// assets/js/app.js

// 請改成你自己的 Cloudflare Worker 網址
const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev/";

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

// 這裡維持你原本的對話/互動函式即可
function addMessage(message, sender = "system") {
  const messagesEl = document.getElementById("messages");
  if (!messagesEl) return;
  const div = document.createElement("div");
  div.className = sender;
  div.textContent = message;
  messagesEl.appendChild(div);
}

function sendChoice(choice) {
  if (choice === 1) {
    addMessage("孔子：善哉！學而時習之，不亦說乎？", "孔子");
  } else if (choice === 2) {
    addMessage("Gemini AI：正在生成現代解讀……", "ai");
    // 這裡可帶上對應論語文本做 prompt
    const prompt = "請用現代語言解讀以下論語內容：...（自行拼接）";
    askGemini(prompt, function(aiAnswer) {
      addMessage("Gemini AI：" + aiAnswer, "ai");
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
  askGemini(question, function(aiAnswer) {
    addMessage("Gemini AI：" + aiAnswer, "ai");
  });

  input.value = "";
  document.getElementById("custom-input").style.display = "none";
}
// 請改成你自己的 Cloudflare Worker 網址
const CLOUD_FLARE_WORKER_URL = "https://lunyu.bdfz.workers.dev/";

// 用於存放整個 dialogues.json
let allData = [];

// 12 地支
const ZODIAC_LABELS = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
// 計算每支分配多少個
const TOTAL_COUNT = 468;
const COUNT_PER_ZODIAC = Math.ceil(TOTAL_COUNT / 12); // 468/12=39,剛好

// 分組資料 { "子": [ {...}, {...} ], "丑": [...], ... }
let groupedZodiac = {};

// 用於顯示當前選擇的條目
let currentAnalect = null;

/* ========== 分配到 12 地支 ========== */
function groupChaptersIntoZodiac(data) {
  // 初始化空陣列
  ZODIAC_LABELS.forEach(label => {
    groupedZodiac[label] = [];
  });

  // 將 id=1~468 分配到對應地支
  // ID 1~39 => 子, 40~78 => 丑, 79~117 => 寅, ...
  // 公式: index = Math.floor( (id-1)/39 )
  // label = ZODIAC_LABELS[index]
  data.forEach(item => {
    const id = item.id;
    if (id < 1 || id > 468) return; // 超出範圍就忽略
    const index = Math.floor((id - 1) / COUNT_PER_ZODIAC); // 0~11
    const label = ZODIAC_LABELS[index];
    groupedZodiac[label].push(item);
  });
}

/* ========== 生成 12 地支按鈕 ========== */
function renderZodiacMenu() {
  const menu = document.getElementById("zodiac-menu");
  if (!menu) return;
  menu.innerHTML = "";

  ZODIAC_LABELS.forEach(label => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.onclick = () => {
      showChapterList(label);
    };
    menu.appendChild(btn);
  });
}

/* ========== 顯示該地支下的所有章節 ========== */
function showChapterList(label) {
  const listContainer = document.getElementById("chapter-list");
  if (!listContainer) return;
  listContainer.style.display = "block";
  listContainer.innerHTML = `<h2>${label} - 章節列表</h2>`;

  const chapters = groupedZodiac[label];
  if (!chapters || chapters.length === 0) {
    listContainer.innerHTML += `<p>此地支暫無內容</p>`;
    return;
  }

  // 建立超連結
  chapters.forEach(ch => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = `ID:${ch.id}`;
    a.onclick = () => {
      displayChapter(ch.id);
      return false;
    };
    listContainer.appendChild(a);
  });

  // 隱藏 chapter-content
  document.getElementById("chapter-content").style.display = "none";
}

/* ========== 顯示選中的條目 ========== */
function displayChapter(id) {
  // 在 allData 或 groupedZodiac 中找
  const item = allData.find(x => x.id === id);
  if (!item) return;

  currentAnalect = item; // 全域記錄
  const contentEl = document.getElementById("chapter-content");
  if (!contentEl) return;
  contentEl.style.display = "block";
  contentEl.innerHTML = `
    <h2>${item.title}</h2>
    <p><strong>正文：</strong>${item.text}</p>
    <p><strong>譯文：</strong>${item.translation || "（無譯文）"}</p>
    <p><strong>注釋：</strong>${item.annotations || "（無注釋）"}</p>
  `;
}

/* ========== AI 互動邏輯 (沿用你的程式) ========== */
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
  div.textContent = message;
  messagesEl.appendChild(div);
}

function formatAnswer(text) {
  return text
    .split('\n')
    .map(line => `<p>${line.trim()}</p>`)
    .join('');
}

// 按鈕點擊：孔子 or Gemini AI
function sendChoice(choice) {
  if (!currentAnalect) {
    addMessage("尚未載入任何論語內容，請稍後再試。", "system");
    return;
  }

  if (choice === 1) {
    const explanation = `譯文：${currentAnalect.translation || "（無譯文）"}\n\n注釋：${currentAnalect.annotations || "（無注釋）"}`;
    addMessage(explanation, "孔子");
  } else if (choice === 2) {
    addMessage("Gemini AI：正在生成現代解讀……", "ai");
    const prompt = `請用現代語言解讀以下論語內容：\n${currentAnalect.text}`;
    askGemini(prompt, function(aiAnswer) {
      addMessage("Gemini AI：" + formatAnswer(aiAnswer), "ai");
    });
  }
}

// 顯示自由提問
function showInput() {
  const customInputEl = document.getElementById("custom-input");
  if (customInputEl) {
    customInputEl.style.display = "block";
  }
}

// 提交自由提問
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

/* ========== 載入 dialogues.json & 初始化 ========== */
document.addEventListener("DOMContentLoaded", () => {
  // 讀取 JSON
  fetch("data/dialogues.json")
    .then(res => res.json())
    .then(data => {
      allData = data;
      // 分組
      groupChaptersIntoZodiac(data);
      // 生成 12 地支按鈕
      renderZodiacMenu();
    })
    .catch(err => console.error("讀取 dialogues.json 發生錯誤：", err));
});
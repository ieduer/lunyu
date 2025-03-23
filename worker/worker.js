addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  async function handleRequest(request) {
    // 處理預檢請求 (CORS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }
  
    try {
      // 解析前端傳來的 JSON
      const { prompt } = await request.json();
  
      // 從 Wrangler Secret 注入 (以 wrangler secret put GEMINI_API_KEY 設定)
      const apiKey = GEMINI_API_KEY; 
  
      console.log("Received prompt:", prompt);
  
      // 準備 API 請求的 URL
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-thinking-exp-01-21:generateContent?key=${apiKey}`;
  
      // 依照 cURL 範例，組裝 body
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 64,
          topP: 0.95,
          maxOutputTokens: 65536,
          responseMimeType: "text/plain"
        }
      };
  
      // 呼叫 Google API
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
  
      // 解析結果
      const result = await apiResponse.json();
      console.log("Google API raw response:", JSON.stringify(result));
  
      // 取得回覆 (可能要視 result 結構調整)
      // 若 candidates 不存在或空，預設 "暫無回應"
      const aiAnswer = result?.candidates?.[0]?.content?.parts?.[0]?.text || "暫無回應";
  
      // 回傳給前端
      return new Response(JSON.stringify({ answer: aiAnswer }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    } catch (error) {
      console.log("Worker error:", error);
      return new Response(JSON.stringify({ answer: "API 請求錯誤" }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    }
  }
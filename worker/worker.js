addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  /**
   * 主函式：處理前端請求，代理轉發至 Gemini API
   */
  async function handleRequest(request) {
    // 1. 若是 OPTIONS，回傳預檢的 CORS 設定
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
      // 2. 從前端 JSON 讀取 prompt
      const { prompt } = await request.json();
  
      // 3. 從 Wrangler Secret 讀取 API Key（不硬編）
      //    你必須先使用 `wrangler secret put GEMINI_API_KEY` 設定此 Secret
      const apiKey = GEMINI_API_KEY;
  
      // 4. 呼叫 Google Gemini API
      const apiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-thinking-exp-01-21:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // 這裡根據你目前的結構，示範官方 "contents" 格式
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
  
      const result = await apiResponse.json();
      // 若成功回傳，將 AI 內容放在 aiAnswer
      const aiAnswer = result?.candidates?.[0]?.content?.parts?.[0]?.text || "暫無回應";
  
      // 5. 將結果回傳給前端，並帶上正確的 CORS 標頭
      return new Response(JSON.stringify({ answer: aiAnswer }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        }
      });
    } catch (error) {
      // 6. 若出現錯誤，回傳錯誤訊息並帶 CORS
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
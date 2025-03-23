addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  async function handleRequest(request) {
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
      const { prompt } = await request.json();
  
      // 如果有多金鑰輪換，就確保 getCurrentApiKey() 返回的是有效的 key
      const apiKey = GEMINI_API_KEY; // 或 getCurrentApiKey();
  
      // 打印 prompt 以確定前端帶來了什麼
      console.log("Received prompt:", prompt);
  
      // 調用 Google API
      const apiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-thinking-exp-01-21:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
  
      // 解析結果並打印
      const result = await apiResponse.json();
      console.log("Google API raw response:", JSON.stringify(result));
  
      const aiAnswer = result?.candidates?.[0]?.content?.parts?.[0]?.text || "暫無回應";
  
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
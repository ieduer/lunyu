addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  /**
   * 輪換 API 金鑰：根據當前 UTC 小時從 API_KEYS_JSON Secret 中選取金鑰
   */
  function getCurrentApiKey() {
    const keys = JSON.parse(API_KEYS_JSON); // API_KEYS_JSON 需使用 wrangler secret put 設定，例如 '["key1", "key2", "key3"]'
    const hour = new Date().getUTCHours();
    return keys[hour % keys.length];
  }
  
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
      const apiKey = getCurrentApiKey();
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
      const result = await apiResponse.json();
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
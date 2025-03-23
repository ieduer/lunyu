addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
  
  async function handleRequest(request) {
    try {
      const { prompt } = await request.json();
  
      // 直接從全域變數獲取金鑰
      const apiKey = GEMINI_API_KEY; // 由 Wrangler Secret 注入
  
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
      const aiAnswer = result.candidates && result.candidates[0].content.parts[0].text || "暫無回應";
      
      return new Response(JSON.stringify({ answer: aiAnswer }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ answer: "API 請求錯誤" }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
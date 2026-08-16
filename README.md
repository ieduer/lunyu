# 說明  
>高考要考《論語》，這本身⋯⋯就挺變態的。那麼，何妨應之以變態。  
>週末，想起學生課間刷網頁遊戲，那，何妨再加一個孔子當玩具。  
>《論語譯註》的數據很久之前就分章發布在論壇，現在格式化就好。  
>然後最小代碼，建GitHub內lunyu庫，推CF，早九晚六，成功上線。  

玩法：
每次刷新頁面，會隨機出論語正文一則。 

下方有：
- 孔子：我該如何解釋這句？ 
- Gemini AI：請給我現代解讀 
- 自由提問


孔子的解釋，會直接顯示楊伯峻譯註的譯文和注釋。  
Gemini AI會跟你長長長長說下ta的看法。  
覺得孔子或Gemini AI在瞎扯？那你可以點自由提問，跟這兩個一起扯，對話成三人，嗯。

目錄完成，進度統計未完成，沒想好該如何設計，先擱置。  
本來設置了多個API每小時輪轉，後來撤了，沒那麼多人讀這玩意的，應該。

代碼全部開源在這，論語數據也是；有能力繼續深加工的，拿走就好。  
學術為公器，技術也是。

網址 https://kz.bdfz.net/  
字體：匯文明朝體。

> 以上為說明文字1.0，更新說明會在：<a href="https://bdfz.net/posts/lunyu" target="_blank" rel="noopener noreferrer">AI論語</a>
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## A+ 學習證據

- 541 條真實《論語》內容由 `data/dialogues.json` 重建成 `data/learning-manifest.json`；30% 門檻為 163 條。
- 選章、頁面瀏覽、隨機展示不算完成。只有使用者主動點擊「楊伯峻《論語譯註》」，實際顯示譯文與現有注釋後，才在本機標記完成。
- 只有已登入 User Center 的使用者會先經同源
  `/api/learning/complete` 呼叫 `KzGrowthEvidence` 來源 RPC；取得精確
  `resourceKey`／`manifestVersion` 回執後，才寫入穩定
  `chapter-<id>` legacy progress 與 event。匿名使用者不產生任何完成
  證據。
- Function 強制核對同源 `Origin`、`bdfz_uc_session`、當前 manifest
  版本及結構正確的 `chapter-<id>`；瀏覽器自報的分數、正誤或完成比例
  會直接被拒絕，不能用來刷入正式證據。
- 對話與 AI 提問是 `journey_only`，不能代替章節完成；本站沒有作答／判錯流程，不虛構「答錯」資料。

完整契約、驗證與回滾見 [`docs/VERIFICATION.md`](docs/VERIFICATION.md)。

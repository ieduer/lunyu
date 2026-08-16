# AI 論語核查標準 / Verification Standard

最後本機核驗：Codex，2026-07-28。來源變更尚未部署。

1. **Source of truth**：`/Users/ylsuen/CF/lunyu`；Git remote `ieduer/lunyu` branch `main`；Pages project `lunyu`；公開域名 `https://kz.bdfz.net/`；User Center site key `kz`；靜態內容 `data/dialogues.json`；版本化學習清單 `data/learning-manifest.json`。
2. **健康探針**：
   ```bash
   curl -fsS https://kz.bdfz.net/
   curl -fsS https://kz.bdfz.net/data/dialogues.json | jq -e 'length == 541'
   curl -fsS https://kz.bdfz.net/data/learning-manifest.json \
     | jq -e '.schemaVersion == 1 and .siteKey == "kz" and .itemCount == 541 and .completionThreshold == 163'
   curl -fsS https://kz.bdfz.net/api/learning/health \
     | jq -e '.ok == true and .sourceSiteKey == "kz"'
   ```
   第三條只有來源部署後才應通過；部署前目前會由 Pages 以 `text/html` 首頁 fallback 回 200，不能把該狀態誤判為 manifest 已上線。
3. **關鍵契約**：
   - `npm run build:learning-manifest` 必須由 `data/dialogues.json` 重建清單；目前 manifest `kz-79b9c5647108bc9b`，541 個唯一 `chapter-<id>`，30% 向上取整為 163。
   - 頁面開啟、隨機章節、目錄選章不得呼叫完成寫入。完成動作固定為使用者主動顯示楊伯峻譯文及可用注釋，`completionKind=annotation_revealed`。
   - 匿名 Session 不得呼叫來源完成 RPC、`syncProgress`、`recordEvent`
     或 `recordConversation`，也不得把資料放入 SDK 延後佇列。
     `site-auth.js` 必須保持 `data-auto-pageview=false`。
   - 章節完成先 POST 同源 `/api/learning/complete`。Pages Function 必須
     以 `GROWTH_EVIDENCE` service binding 呼叫 Worker
     `bdfz-user-center` 的 `KzGrowthEvidence` entrypoint；只有來源回執
     成功後才寫 stable legacy progress 與 unique event。對話／提問
     標為 `journey_only`，不可替代章節完成。
   - 防刷條件固定為：POST `Origin` 必須等於當前站點 origin、Cookie
     必須含 `bdfz_uc_session`、manifest 必須是當前 `kz` 版本、resource
     必須是 manifest 內且 `itemType=chapter`、`resourceKey` 必須與
     `chapterId` 相互一致。請求若含 `score`、`progressPercent`、
     `correct` 或 `completed` 等瀏覽器自報結果，Function 直接回 400；
     RPC 僅收到固定四欄完成契約。
   - 本站沒有答案提交或判錯流程；不得把 AI 錯誤、對話或選章偽造成 `incorrect`／`completed`。若未來新增題目，`result=incorrect` 必須與 `result=completed` 分開，中央只接受後者。
4. **部署命令與禁止事項**：
   ```bash
   cd /Users/ylsuen/CF/lunyu
   npm run check
   npx wrangler pages functions build --outfile /tmp/kz-pages-functions.mjs
   # 先用 wrangler pages download config lunyu 核對 dashboard 設定，
   # 再由根任務製作只含規範資產及 functions 的 checksum staging artifact：
   npx wrangler pages deploy <CHECKSUMMED_STAGING_DIR> --project-name lunyu --branch main
   ```
   禁止從含 `.git`、`.wrangler`、`.DS_Store` 或私有備份的 repo 根直接上傳；禁止在本來源任務部署；禁止把頁面瀏覽／選章納入完成證據；禁止修改 User Center evaluator 時放寬舊資料。
5. **依賴回歸**：部署任務須驗證 User Center Session、登入／匿名雙路、manifest 200/雜湊、選章零寫入、顯示譯注後 progress+event、AI 導師、目錄、深淺色、桌面／手機、console/network、`my.bdfz.net` drill-down，以及 Companion WebView。
6. **備份／恢復**：2026-07-28 來源前 mode-600 備份在
   `/Users/ylsuen/CF/output/student-growth-pages-sources-20260728/prechange/lunyu/`。
   本站無 D1/R2 寫入，因此來源任務不需資料庫備份。
7. **回滾**：2026-07-14 read-only live check 的 current Pages deployment 為 `6ee7df3a-b683-4cf2-baf4-00b4bc44a370`。文檔已驗證的既有健康回滾錨點為 `06c364c8-fb45-47ab-95f7-b682df8221f3`；亦可重發 checksum 驗證的前版靜態 artifact。Wrangler 沒有通用 Pages rollback CLI，不得虛構命令。
8. **驗證命令與當前狀態**：
   ```bash
   npm run check
   npm run build
   npm run check:learning-manifest
   git diff --check
   ```
   2026-07-28 本機 manifest、來源先於 legacy 的失敗關閉測試、
   Function mock contract 及 Pages Functions compilation 已通過，沒有
   部署。讀取 Cloudflare Pages 設定時，最新部署為 `497c8742`，正式
   與預覽都尚無 `GROWTH_EVIDENCE` binding。

## User Center A+ evaluator 精確契約

正式計分首先接受 `KzGrowthEvidence` 寫入的 source-owned
`learning_evidence`；下列中央 progress 僅保留 UI／歷史相容，不得
自行升格為正式計分證據。其 legacy 候選仍須讀取當前
`data/learning-manifest.json`，而不是把資料列總數當分母，並同時滿足：

- `site_key = 'kz'`
- `item_key` 完全存在於 manifest `items[].resourceKey`
- `item_type = 'chapter'`
- `state IN ('completed','done')` 且 `progress >= 100`
- `meta.evidenceSchema = 'kz-learning-evidence-v1'`
- `meta.manifestVersion = manifest.manifestVersion`
- `meta.resourceKeySha256 = manifest.resourceKeySha256`
- `meta.resourceKey = item_key`
- `meta.completionKind = 'annotation_revealed'`
- `meta.result = 'completed'`

並且要有同一學年、同一使用者、同一 `resourceKey` 的 supporting event：`record_kind=event`、`item_type=chapter_completion`、`content_format=kz-learning-evidence-v1`、`payload.eventName=chapter_completed`，其 manifest/hash/completion/result 欄位須與 progress 相同。按 manifest 內合法 `item_key` 去重；`target = ceil(itemCount * 0.30)`，目前 `ceil(541*0.30)=163`。任何舊 `chapter-*` row 若缺上述版本與 action metadata，都必須 fail closed，不能沿用為 A+ 證據。

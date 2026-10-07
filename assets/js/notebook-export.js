const STORAGE_KEY = 'lunyu_bookmarks';
const SOURCE_VERSION = 'kz-notebook-v1:69674ff';

// Pure serialization; neither source storage nor account/learning evidence is changed.
export function createBookmarkExport(raw, exportedAt = new Date().toISOString()) {
  if (raw === null) return null;
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 128 * 1024) throw Error('invalid_bookmarks');
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.length > 4096 || ids.some(id => !Number.isInteger(id) || id < 1 || id > 541)) throw Error('invalid_bookmarks');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt) || !Number.isFinite(Date.parse(exportedAt))) throw Error('invalid_time');
  const header = JSON.stringify({format:'analects-notebook-export-v1',source:'kz-browser',exportedAt,sourceVersion:SOURCE_VERSION,ownership:'unbound-browser'});
  return {ids, text:JSON.stringify({header,records:[JSON.stringify({storageKey:STORAGE_KEY,raw})]},null,2)+'\n'};
}

if (typeof document !== 'undefined') {
  const status = document.getElementById('export-status'), preview = document.getElementById('bookmark-preview');
  const confirm = document.getElementById('confirm-personal'), download = document.getElementById('download-bookmarks');
  let snapshot = null, sourceRaw = null;
  const clear = () => { snapshot = null; sourceRaw = null; preview.hidden = true; confirm.checked = false; download.disabled = true; document.getElementById('bookmark-raw').value = ''; };
  document.getElementById('read-bookmarks').addEventListener('click', () => {
    clear();
    try {
      if (location.origin !== 'https://kz.bdfz.net' && !['localhost','127.0.0.1'].includes(location.hostname)) throw Error('wrong_origin');
      const raw = localStorage.getItem(STORAGE_KEY), result = createBookmarkExport(raw);
      if (!result || !result.ids.length) { status.textContent = '這個瀏覽器目前沒有可匯出的收藏。其他瀏覽器或裝置的資料不會在這裡顯示。'; return; }
      sourceRaw = raw; snapshot = result; preview.hidden = false;
      document.getElementById('bookmark-count').textContent = `${result.ids.length} 筆原收藏，共 ${new Set(result.ids).size} 個原章號。別名與重複紀錄保持原樣。`;
      document.getElementById('bookmark-raw').value = raw;
      status.textContent = '已讀取本機副本，尚未下载或上傳。';
    } catch { clear(); status.textContent = '無法完整核對這個瀏覽器的收藏，原資料保持不變。請確認是在 kz.bdfz.net 的原瀏覽器開啟此頁，並保留原資料。'; }
  });
  confirm.addEventListener('change', () => { download.disabled = !snapshot || !confirm.checked; });
  download.addEventListener('click', () => {
    if (!snapshot || !confirm.checked) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) !== sourceRaw) { clear(); status.textContent = '收藏剛有變更，請重新讀取再確認，避免遺漏最新內容。'; return; }
      const link = document.createElement('a'), url = URL.createObjectURL(new Blob([snapshot.text],{type:'application/json;charset=utf-8'}));
      link.href = url; link.download = 'lunyu-bookmarks-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      status.textContent = '已送交瀏覽器下載。請確認檔案已保存；這個頁面沒有上傳或改寫收藏。';
    } catch { status.textContent = '未能確認下載，原收藏保持不變。請保留此頁與原資料。'; }
  });
  addEventListener('storage', event => { if (event.key === STORAGE_KEY && snapshot) { clear(); status.textContent = '另一個分頁更新了收藏，請重新讀取最新內容。'; } });
}

// Global copy button handler
// Works for any <button class="copy-btn" data-target="elementId">

document.addEventListener('click', event => {
  const btn = event.target.closest('.copy-btn');
  if (!btn) return;
  const targetId = btn.dataset.target;
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!target) return;
  const text = target.innerText || target.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = '已複製';
    setTimeout(() => { btn.textContent = original; }, 1000);
  }).catch(err => console.error('Copy failed', err));
});

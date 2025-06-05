class MoCopyButton extends HTMLElement {
  connectedCallback() {
    const label = this.getAttribute('copy-label') || 'Copy';
    this.textContent = label;
    this.addEventListener('click', () => {
      const targetId = this.getAttribute('from');
      if (!targetId) return;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        const text = targetEl.innerText || targetEl.textContent || '';
        navigator.clipboard.writeText(text).catch(err => console.error('Copy failed', err));
      }
    });
  }
}
customElements.define('mo-copy-button', MoCopyButton);


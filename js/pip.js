// Janela flutuante (Document Picture-in-Picture): o palco do teleprompter
// vira uma janela sempre visível sobre qualquer outro app (Zoom, Meet, OBS…).
export const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

/**
 * Move `stageEl` para uma janela PiP. Devolve a janela; ao fechar, o elemento
 * volta ao lugar original e `onClose` é chamado.
 */
export async function openPip(stageEl, { width = 640, height = 360, onClose, onKey } = {}) {
  if (!pipSupported()) throw new Error('unsupported');
  const pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
  const doc = pipWindow.document;

  // Copia estilos para a nova janela.
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.href) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.appendChild(link);
      } else {
        const style = doc.createElement('style');
        style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        doc.head.appendChild(style);
      }
    } catch { /* folhas de outra origem */ }
  }
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
  doc.body.className = 'pip-body';

  const placeholder = document.createComment('tp-stage-placeholder');
  stageEl.parentNode.insertBefore(placeholder, stageEl);
  doc.body.appendChild(stageEl);
  stageEl.classList.add('in-pip');

  if (onKey) doc.addEventListener('keydown', onKey);

  pipWindow.addEventListener('pagehide', () => {
    stageEl.classList.remove('in-pip');
    placeholder.parentNode?.insertBefore(stageEl, placeholder);
    placeholder.remove();
    onClose?.();
  }, { once: true });

  return pipWindow;
}

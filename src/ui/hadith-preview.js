let previewHadithKey = null;
async function previewHadithImage(key) {
  const dialog = document.getElementById('hadith-image-dialog'),
    status = document.getElementById('hadith-image-status');
  previewHadithKey = key;
  document.getElementById('hadith-image-preview').hidden = true;
  for (const id of ['btn-save-hadith-image', 'btn-copy-hadith-image'])
    document.getElementById(id).disabled = true;
  status.textContent = 'جارٍ تجهيز الصورة كاملة…';
  document.getElementById('hadith-image-preview').removeAttribute('src');
  dialog.showModal();
  try {
    const result = await window.mihrabApi.previewHadithImage(key);
    if (previewHadithKey !== key || !dialog.open) return;
    document.getElementById('hadith-image-preview').src = result.dataUrl;
    document.getElementById('hadith-image-preview').hidden = false;
    for (const id of ['btn-save-hadith-image', 'btn-copy-hadith-image'])
      document.getElementById(id).disabled = false;
    status.textContent = '';
    animatePanel(dialog);
  } catch (error) {
    status.textContent = error.message;
  }
}
function initializeHadithImagePreview() {
  const dialog = document.getElementById('hadith-image-dialog');
  document.getElementById('btn-close-hadith-image').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    previewHadithKey = null;
    setTimeout(() => {
      if (!dialog.open) document.getElementById('hadith-image-preview').removeAttribute('src');
    }, motionDuration() + 40);
  });
  for (const [id, action] of [
    ['btn-save-hadith-image', 'exportHadithImage'],
    ['btn-copy-hadith-image', 'copyHadithImage'],
  ])
    document.getElementById(id).addEventListener('click', async (event) => {
      if (!previewHadithKey) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await window.mihrabApi[action](previewHadithKey);
        briefInlineFeedback(
          document.getElementById('hadith-image-status'),
          result.canceled
            ? 'أُلغي الحفظ.'
            : result.saved
              ? 'تم تحميل الصورة.'
              : 'نُسخت الصورة إلى الحافظة.',
        );
      } catch (error) {
        document.getElementById('hadith-image-status').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
}

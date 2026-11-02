function updatePreferencesFromForm() {
  return {
    enabled: document.getElementById('update-enabled').checked,
    autoDownload: document.getElementById('update-auto-download').checked,
    prerelease: document.getElementById('update-prerelease').checked,
  };
}
function renderUpdateStatus(data) {
  const node = document.getElementById('update-status');
  node.textContent = data.message;
  document.getElementById('update-current-version').textContent = data.version;
  document.getElementById('update-next-version').textContent = data.nextVersion || '—';
  const progress = document.getElementById('update-progress');
  progress.hidden = data.phase !== 'downloading';
  progress.value = data.percent || 0;
  document.getElementById('update-last-check').textContent = data.lastChecked
    ? new Date(data.lastChecked).toLocaleString('ar')
    : 'لم يُجرَ تحقق بعد';
  document.getElementById('update-check').disabled = [
    'checking',
    'downloading',
    'unsupported',
    'downloaded',
  ].includes(data.phase);
  document.getElementById('update-download').hidden = data.phase !== 'available';
  document.getElementById('update-install').hidden = data.phase !== 'downloaded';
}
function initializeUpdates() {
  const p = state.config?.updates || {};
  for (const [id, key] of [
    ['update-enabled', 'enabled'],
    ['update-auto-download', 'autoDownload'],
    ['update-prerelease', 'prerelease'],
  ])
    document.getElementById(id).checked = key === 'enabled' ? p[key] !== false : p[key] === true;
  window.mihrabApi.onUpdateStatus(renderUpdateStatus);
  window.mihrabApi
    .getUpdateStatus()
    .then(renderUpdateStatus)
    .catch((e) => (document.getElementById('update-status').textContent = e.message));
  for (const [id, method] of [
    ['update-check', 'checkForUpdate'],
    ['update-download', 'downloadUpdate'],
  ])
    document.getElementById(id).addEventListener('click', async () => {
      try {
        if (dirtySettingsGroups().includes('updates'))
          throw Error('احفظ خيارات التحديث أولاً لتطبيق القناة المحددة.');
        await window.mihrabApi[method]();
      } catch (e) {
        document.getElementById('update-status').textContent = e.message;
      }
    });
  const dialog = document.getElementById('update-install-dialog');
  document.getElementById('update-install').addEventListener('click', () => {
    document.getElementById('update-install-error').textContent = '';
    dialog.showModal();
  });
  document.getElementById('update-install-cancel').addEventListener('click', () => dialog.close());
  document.getElementById('update-install-confirm').addEventListener('click', async () => {
    try {
      if (dirtySettingsGroups().length) throw Error('احفظ الإعدادات المعدلة قبل إعادة التشغيل.');
      await window.mihrabApi.installUpdate();
    } catch (e) {
      document.getElementById('update-install-error').textContent = e.message;
    }
  });
}

function renderQuranNotificationShortcuts() {
  const mode =
    state.quranState?.settings?.notificationMode ||
    state.config?.quranWird?.notificationMode ||
    'both';
  for (const kind of ['reading', 'hifz']) {
    const button = document.getElementById('btn-' + kind + '-notification');
    if (!button) continue;
    const enabled = mode === 'both' || mode === kind + '_only';
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute(
      'aria-label',
      (enabled ? 'إيقاف' : 'تفعيل') +
        ' إشعار ' +
        (kind === 'reading' ? 'ورد القراءة' : 'ورد الحفظ'),
    );
    button.querySelector('span').textContent = enabled ? 'الإشعار مفعّل' : 'الإشعار متوقف';
  }
}
function updateQuranSettingsSection() {
  const kind = state.quranMode === 'hifz' ? 'hifz' : 'reading';
  for (const section of document.querySelectorAll('[data-quran-settings-kind]'))
    section.hidden = section.dataset.quranSettingsKind !== kind;
}
function positionProjectInfoButton() {
  const settings = document.getElementById('btn-floating-settings'),
    info = document.getElementById('btn-project-info');
  if (!settings || !info) return;
  const rect = settings.getBoundingClientRect();
  Object.assign(info.style, {
    left: rect.left + 'px',
    top: rect.bottom + 10 + 'px',
    right: 'auto',
    bottom: 'auto',
    width: rect.width + 'px',
    height: rect.height + 'px',
  });
}
function initializeProjectInfo() {
  positionProjectInfoButton();
  window.addEventListener('resize', positionProjectInfoButton);
  for (const kind of ['reading', 'hifz'])
    document.getElementById('btn-' + kind + '-notification').addEventListener('click', async () => {
      const buttons = [...document.querySelectorAll('.quran-notification-shortcut')];
      buttons.forEach((b) => (b.disabled = true));
      try {
        const res = await window.mihrabApi.toggleQuranNotification(kind);
        state.config = res.config;
        state.quranState = res.quranState;
        renderQuranSummaries(res.quranState);
        renderQuranNotificationShortcuts();
        // Preserve other unsaved notification fields; only the mode is synchronized.
        const select = document.getElementById('quran-notif-mode');
        select.value = res.quranState.settings.notificationMode;
        syncNotificationControls();
        const baseline = settingsDraftBaselines.get('notifications');
        if (baseline) {
          const fields = JSON.parse(baseline);
          for (const pair of fields) if (pair[0] === 'quran-notif-mode') pair[1] = select.value;
          settingsDraftBaselines.set('notifications', JSON.stringify(fields));
        }
        showSuccessFeedback('تم تحديث إشعار الورد.');
      } catch (error) {
        showOperationResultModal({
          success: false,
          title: 'تعذر تعديل إشعار الورد',
          summary: error.message,
        });
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    });
  const dialog = document.getElementById('project-info-dialog');
  document.getElementById('btn-project-info').addEventListener('click', async () => {
    dialog.showModal();
    const status = document.getElementById('project-contact-status');
    status.textContent = 'جارٍ تحميل وسائل الدعم…';
    try {
      const info = await window.mihrabApi.getProjectInfo();
      for (const button of document.querySelectorAll('[data-project-contact]')) {
        const kind = button.dataset.projectContact;
        button.disabled = !info.contacts[kind];
      }
      status.textContent = info.configured ? '' : 'وسائل الدعم غير مهيأة حالياً.';
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById('btn-close-project-info').addEventListener('click', () => dialog.close());
  for (const button of document.querySelectorAll('[data-project-contact]'))
    button.addEventListener('click', async () => {
      if (button.dataset.projectContact === 'paypal') {
        document.getElementById('paypal-redirect-dialog').showModal();
        return;
      }
      try {
        await window.mihrabApi.openProjectContact(button.dataset.projectContact);
      } catch (error) {
        document.getElementById('project-contact-status').textContent = error.message;
      }
    });
  document
    .getElementById('btn-about-support')
    .addEventListener('click', () => document.getElementById('data-about-section-support').click());
  document.getElementById('btn-unsupported-card').addEventListener('click', async () => {
    const modal = document.getElementById('card-not-supported-dialog'),
      status = document.getElementById('bank-support-status');
    modal.showModal();
    status.textContent = 'جارٍ تحميل بيانات التحويل محلياً…';
    for (const field of document.querySelectorAll('[data-bank-value]')) field.textContent = '—';
    document.querySelectorAll('[data-copy-bank]').forEach((button) => (button.disabled = true));
    try {
      const info = await window.mihrabApi.getBankSupport();
      if (!modal.open) return;
      for (const field of document.querySelectorAll('[data-bank-value]')) {
        const key = field.dataset.bankValue;
        field.textContent = info.bank[key] || 'غير متوفر';
      }
      for (const button of document.querySelectorAll('[data-copy-bank]'))
        button.disabled = !info.bank[button.dataset.copyBank];
      status.textContent = '';
    } catch (error) {
      status.textContent = error.message;
    }
  });
  for (const button of document.querySelectorAll('[data-copy-bank]'))
    button.addEventListener('click', async () => {
      const status = document.getElementById('bank-support-status');
      try {
        await window.mihrabApi.copyBankField(button.dataset.copyBank);
        briefInlineFeedback(status, 'تم نسخ المعلومة.');
      } catch (error) {
        status.textContent = error.message;
      }
    });
  document.getElementById('card-not-supported-dialog').addEventListener('close', () => {
    for (const field of document.querySelectorAll('[data-bank-value]')) field.textContent = '—';
  });
  for (const button of document.querySelectorAll('[data-close-project-dialog]'))
    button.addEventListener('click', () => button.closest('dialog').close());
  document.getElementById('btn-continue-paypal').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await window.mihrabApi.openProjectContact('paypal');
      document.getElementById('paypal-redirect-dialog').close();
    } catch (error) {
      document.getElementById('paypal-redirect-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

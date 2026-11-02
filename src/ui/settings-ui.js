// One live editor per settings group: move it into the popover, never clone its IDs.
let inlineEditor = null;
function positionInlineSettings() {
  if (!inlineEditor) return;
  const popup = document.getElementById('inline-settings-popover'),
    r = inlineEditor.button.getBoundingClientRect();
  const width = Math.min(
    inlineEditor.panel.id === 'region-general-settings' ? 410 : 380,
    innerWidth - 24,
  );
  popup.style.width = width + 'px';
  popup.style.left = Math.max(12, Math.min(innerWidth - width - 12, r.left)) + 'px';
  const top = Math.max(12, Math.min(r.bottom + 8, innerHeight - 180));
  popup.style.top = top + 'px';
  popup.style.maxHeight = Math.min(540, Math.max(150, innerHeight - top - 16)) + 'px';
}
function restoreInlineEditor() {
  if (!inlineEditor) return;
  const { panel, marker, button } = inlineEditor;
  marker.replaceWith(panel);
  button.setAttribute('aria-expanded', 'false');
  inlineEditor = null;
}
function closeInlineSettings() {
  const p = document.getElementById('inline-settings-popover');
  if (p?.matches(':popover-open')) p.hidePopover();
  restoreInlineEditor();
}
function openInlineSettings(button, panelId) {
  if (inlineEditor?.button === button) {
    closeInlineSettings();
    return;
  }
  closeInlineSettings();
  const panel = document.getElementById(panelId),
    marker = document.createComment('settings-home');
  panel.before(marker);
  inlineEditor = { panel, marker, button };
  document.getElementById('inline-settings-content').append(panel);
  button.setAttribute('aria-expanded', 'true');
  const popup = document.getElementById('inline-settings-popover');
  popup.setAttribute('aria-label', panel.querySelector('h3')?.textContent || 'الإعدادات');
  positionInlineSettings();
  popup.showPopover();
  popup.querySelector('button,input,select')?.focus({ preventScroll: true });
}
function validateSettingsFields(container) {
  for (const input of container.querySelectorAll('input,select'))
    if (!input.disabled && !input.checkValidity()) {
      input.reportValidity();
      throw Error('راجع القيمة المحددة في إعداداتك.');
    }
}
function collectRegionSettings() {
  validateSettingsFields(document.getElementById('region-general-settings'));
  const value = (id) => document.getElementById(id).value;
  if (!value('settings-city-name').trim() || !value('settings-lat') || !value('settings-lng'))
    throw Error('اختر مدينة أو أدخل اسمها وإحداثياتها.');
  return {
    location: {
      autoDetect: false,
      city: value('settings-city-name').trim(),
      countryCode: value('settings-country-select'),
      country: value('settings-country-name').trim(),
      timeZone: value('settings-time-zone'),
      calculationMethod: value('settings-calc-method'),
      calculationMethodSelection: state.methodManuallySelected ? 'manual' : 'auto',
      lat: Number(value('settings-lat')),
      lng: Number(value('settings-lng')),
    },
    prayerAdjustments: Object.fromEntries(
      ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((id) => [
        id,
        Number(value('adj-' + id)),
      ]),
    ),
  };
}
async function saveRegionSettings() {
  const status = document.getElementById('region-settings-status');
  cancelInlineFeedback(status);
  try {
    if (state.locationBusy) throw Error('انتظر اكتمال تحميل المدن.');
    status.textContent = 'جارٍ الحفظ…';
    const res = await window.mihrabApi.saveSettings(collectRegionSettings());
    renderSettingsForm(res.config, null);
    renderPrayerTimes(res.prayerData);
    renderQuranState(res.quranState);
    briefInlineFeedback(status, 'تم حفظ المنطقة وتحديث المواقيت.');
  } catch (error) {
    status.textContent = error.message;
    showOperationResultModal({ success: false, title: 'تعذر حفظ المنطقة', summary: error.message });
  }
}
function syncNotificationControls() {
  const el = (id) => document.getElementById(id),
    lock = el('settings-lock-enabled').checked;
  el('notice-prayer-fields').disabled = !el('notice-prayer-enabled').checked;
  el('notice-prayer-fields').hidden = !el('notice-prayer-enabled').checked;
  el('pre-prayer-editor').disabled = lock;
  el('pre-prayer-editor').hidden = lock;
  el('pre-prayer-lock-hint').hidden = !lock;
  el('notice-pre-fields').disabled = !el('notice-pre-enabled').checked;
  el('notice-pre-fields').hidden = !el('notice-pre-enabled').checked;
  el('settings-friday-min').disabled = !el('notice-friday-enabled').checked;
  const fridayCard = el('settings-friday-min').closest('.pre-reminder-card');
  for (const node of fridayCard.querySelectorAll('.form-group,small'))
    node.hidden = !el('notice-friday-enabled').checked;
  for (const id of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    el('notice-minutes-' + id).disabled = !el('notice-pre-' + id).checked;
    el('notice-minutes-' + id).parentElement.hidden = !el('notice-pre-' + id).checked;
  }
  el('lock-notification-settings').hidden = !lock;
  el('lock-notification-disabled-hint').hidden = lock;
  el('settings-lock-mute').closest('label').hidden = !lock;
  for (const input of el('lock-notification-settings').querySelectorAll('input'))
    input.disabled = !lock;
  for (const kind of ['reading', 'hifz']) updateQuranTiming(kind);
  const lessons = el('notice-lessons-enabled').checked,
    fixed = el('lesson-custom-enabled').checked;
  el('notice-lessons-fields').disabled = !lessons;
  el('notice-lessons-fields').hidden = !lessons;
  for (const mode of ['prayer', 'fixed']) {
    const field = el('lesson-' + mode + '-fields'),
      inactive = (mode === 'fixed') !== fixed;
    field.disabled = !lessons || inactive;
    field.hidden = inactive;
    field.classList.toggle('is-inactive', inactive);
  }
}
function renderNotificationPreferences(config) {
  const n = config.notifications || {},
    check = (id, v) => (document.getElementById(id).checked = v !== false),
    value = (id, v) => (document.getElementById(id).value = v);
  check('notice-prayer-enabled', n.prayerEnabled);
  check('notice-pre-enabled', n.prePrayerEnabled);
  check('notice-friday-enabled', n.fridayPrePrayerEnabled);
  for (const id of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'friday'])
    check('notice-prayer-' + id, n.prayers?.[id]);
  for (const id of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    check('notice-pre-' + id, n.prePrayerOverrides?.[id]?.enabled);
    value('notice-minutes-' + id, n.prePrayerOverrides?.[id]?.minutes ?? '');
  }
  value('settings-lock-warning', config.screenLock?.warningMinutes ?? 1);
  check('settings-lock-mute', config.screenLock?.muteSystemAudio);
  const l = n.lessons || {};
  check('notice-lessons-enabled', l.enabled);
  document.getElementById('lesson-custom-enabled').checked = l.timingMode === 'fixed';
  document.getElementById('lesson-prayer-enabled').checked = l.timingMode !== 'fixed';
  value('lesson-after-prayer', l.prayer || 'isha');
  value('lesson-after-minutes', l.minutesAfter ?? n.dailyVideoAfterIshaMinutes ?? 45);
  value('lesson-custom-time', l.customTime || '20:45');
  syncNotificationControls();
}
function collectNotificationSettings() {
  validateSettingsFields(document.getElementById('notification-settings'));
  const val = (id) => document.getElementById(id).value,
    num = (id) => Number(val(id)),
    checked = (id) => document.getElementById(id).checked;
  const notifications = {
    prayerEnabled: checked('notice-prayer-enabled'),
    playAdhanAudio: checked('settings-audio-enabled'),
    prayers: Object.fromEntries(
      ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'friday'].map((id) => [
        id,
        checked('notice-prayer-' + id),
      ]),
    ),
    prePrayerEnabled: checked('notice-pre-enabled'),
    prePrayerMinutes: num('settings-pre-prayer-min'),
    fridayPrePrayerEnabled: checked('notice-friday-enabled'),
    fridayPrePrayerMinutes: num('settings-friday-min'),
    prePrayerOverrides: Object.fromEntries(
      ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((id) => [
        id,
        {
          enabled: checked('notice-pre-' + id),
          minutes: val('notice-minutes-' + id) === '' ? null : num('notice-minutes-' + id),
        },
      ]),
    ),
    lessons: {
      enabled: checked('notice-lessons-enabled'),
      timingMode: checked('lesson-custom-enabled') ? 'fixed' : 'prayer',
      prayer: val('lesson-after-prayer'),
      minutesAfter: num('lesson-after-minutes'),
      customTime: val('lesson-custom-time'),
    },
  };
  const quranWird = { notificationMode: val('quran-notif-mode') };
  for (const kind of ['reading', 'hifz'])
    quranWird[kind] = {
      timingMode: checked(kind + '-custom-enabled') ? 'fixed' : 'prayer',
      customTimeEnabled: checked(kind + '-custom-enabled'),
      customTime: val(kind + '-custom-time'),
      afterPrayer: val(kind + '-after-prayer'),
      afterPrayerMinutes: num(kind === 'reading' ? 'reading-after-isha' : 'hifz-after-fajr'),
    };
  return {
    notifications,
    quranWird,
    screenLock: {
      minutesBeforeAdhan: num('settings-lock-before'),
      warningMinutes: num('settings-lock-warning'),
      snoozeMinutes: num('settings-lock-snooze'),
    },
  };
}
async function saveAllSettings() {
  const status = document.getElementById('settings-save-status'),
    button = document.getElementById('btn-save-settings');
  button.disabled = true;
  cancelInlineFeedback(status);
  try {
    const groups = dirtySettingsGroups();
    if (groups.length) await commitSettingsGroups(groups);
    briefInlineFeedback(status, 'تم حفظ جميع الإعدادات.');
  } catch (error) {
    status.textContent = error.message;
    showOperationResultModal({
      success: false,
      title: 'تعذر حفظ جميع الإعدادات',
      summary: error.message,
    });
  } finally {
    button.disabled = false;
  }
}
function initializeInlineSettings() {
  initializeSettingsSegments();
  initializeSettingsLeaveGuard();
  initializeResourceSettings();
  const popup = document.getElementById('inline-settings-popover');
  popup.addEventListener('toggle', (event) => {
    if (event.newState === 'closed') restoreInlineEditor();
  });
  document.getElementById('btn-close-inline-settings').addEventListener('click', () => {
    const button = inlineEditor?.button;
    closeInlineSettings();
    button?.focus();
  });
  document
    .getElementById('btn-region-settings')
    .addEventListener('click', (event) =>
      openInlineSettings(event.currentTarget, 'region-general-settings'),
    );
  document.getElementById('btn-save-region').addEventListener('click', saveRegionSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveAllSettings);
  for (const id of ['settings-lock-enabled', 'settings-lock-mute'])
    document.getElementById(id).addEventListener('change', () => {
      syncNotificationControls();
      refreshSettingsDraftStatus();
    });
  document.getElementById('notification-settings').addEventListener('change', (event) => {
    if (event.target.matches('[data-select-search]')) return;
    syncNotificationControls();
    refreshSettingsDraftStatus();
  });
  window.addEventListener('resize', positionInlineSettings);
  let scheduled = false;
  document.addEventListener(
    'scroll',
    (event) => {
      if (!inlineEditor || popup.contains(event.target) || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        positionInlineSettings();
      });
    },
    true,
  );
}

function initializeSettingsSegments() {
  for (const attribute of [
    'data-settings-section',
    'data-notice-section',
    'data-resource-section',
    'data-about-section',
  ]) {
    const buttons = [...document.querySelectorAll('[' + attribute + ']')];
    const activate = (button, focus = false, persist = true) => {
      if (attribute === 'data-resource-section' && persist) {
        resourceViewPreferences.section = button.dataset.resourceSection;
        saveResourceViewPreferences();
      }
      if (attribute !== 'data-about-section')
        for (const item of buttons)
          document
            .getElementById(item.getAttribute('aria-controls'))
            .classList.add('settings-transition-panel');
      for (const item of buttons) {
        const active = item === button;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
      }
      if (focus) button.focus();
    };
    if (attribute === 'data-resource-section') {
      const saved = buttons.find(
        (button) => button.dataset.resourceSection === resourceViewPreferences.section,
      );
      if (saved) activate(saved, false, false);
    }
    for (const [index, button] of buttons.entries()) {
      button.addEventListener('click', () => activate(button));
      button.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else if (event.key === 'ArrowLeft') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowRight') next = (index - 1 + buttons.length) % buttons.length;
        if (next !== undefined) {
          event.preventDefault();
          activate(buttons[next], true);
        }
      });
    }
  }
}

let detectedLocationCandidate = null;
function renderLastPrayerUpdate(report) {
  const node = document.getElementById('prayer-last-update');
  if (!node) return;
  if (!report?.syncedAt) {
    node.textContent = 'لم تُحدّث المواقيت من مزود بعد؛ تُعرض المواقيت المحسوبة لإعدادات منطقتك.';
    return;
  }
  const date = new Date(report.syncedAt);
  if (!Number.isFinite(date.getTime())) {
    node.textContent = '';
    return;
  }
  const stamp = new Intl.DateTimeFormat('ar', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: state.prayerData?.location?.timeZone,
  }).format(date);
  const origin =
    report.origin === 'automatic'
      ? 'تلقائي'
      : report.origin === 'manual'
        ? 'يدوي'
        : 'غير مسجل للبيانات السابقة';
  const kind =
    report.status === 'verified_cached'
      ? 'مطابقة بجدول محفوظ'
      : report.providerKind === 'alternative'
        ? 'ضبط عبر المزود البديل'
        : 'مطابقة التوقيت الرسمي';
  node.textContent = `آخر تحديث: ${stamp} — ${origin} — ${kind}`;
}
function addPrayerNoticeButton(card, prayer, isFriday) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'prayer-notice-toggle';
  if (prayer.id === 'sunrise') {
    button.disabled = true;
    button.textContent = 'الشروق دون أذان';
    card.append(button);
    return;
  }
  const key = isFriday && prayer.id === 'dhuhr' ? 'friday' : prayer.id,
    n = state.config?.notifications || {};
  const enabled = n.prayerEnabled !== false && n.prayers?.[key] !== false;
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', (enabled ? 'إيقاف' : 'تفعيل') + ' إشعار أذان ' + prayer.name);
  button.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>' +
    (enabled ? '' : '<path d="m3 3 18 18"/>') +
    '</svg><span>' +
    (enabled ? 'الإشعار مفعّل' : 'الإشعار متوقف') +
    '</span>';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const current = state.config?.notifications || {},
        globalOff = current.prayerEnabled === false;
      const prayers = globalOff
        ? Object.fromEntries(
            ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'friday'].map((id) => [id, false]),
          )
        : {};
      prayers[key] = !enabled;
      const res = await window.mihrabApi.saveSettings({
        notifications: { prayerEnabled: true, prayers },
      });
      renderSettingsForm(res.config, null);
      renderPrayerTimes(res.prayerData);
      showSuccessFeedback((!enabled ? 'تم تفعيل' : 'تم إيقاف') + ' إشعار ' + prayer.name);
    } catch (error) {
      button.disabled = false;
      showOperationResultModal({
        success: false,
        title: 'تعذر تعديل إشعار الصلاة',
        summary: error.message,
      });
    }
  });
  card.append(button);
}
function initializePrayerPageControls() {
  const dialog = document.getElementById('confirm-detected-location'),
    confirm = document.getElementById('btn-confirm-detected-location'),
    cancel = document.getElementById('btn-cancel-detected-location'),
    errorNode = document.getElementById('detected-location-error');
  let saving = false;
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    detectedLocationCandidate = null;
  });
  cancel.addEventListener('click', () => {
    if (!saving) dialog.close();
  });
  document.getElementById('btn-auto-location').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await window.mihrabApi.detectLocation();
      if (!result.success)
        throw Error(result.error || 'تعذر تحديد الموقع. جرّب اختيار المدينة يدوياً.');
      detectedLocationCandidate = { ...result.location, autoDetect: false };
      errorNode.textContent = '';
      const host = document.getElementById('detected-location-details');
      host.replaceChildren();
      const method =
        document.querySelector(
          '#settings-calc-method option[value="' + result.location.calculationMethod + '"]',
        )?.textContent || result.location.calculationMethod;
      for (const [label, value] of [
        ['المدينة', result.location.city],
        ['الدولة', result.location.country],
        ['الإحداثيات', result.location.lat + '، ' + result.location.lng],
        ['المنطقة الزمنية', result.location.timeZone],
        ['طريقة الحساب', method],
      ]) {
        const term = document.createElement('dt'),
          description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        host.append(term, description);
      }
      dialog.showModal();
    } catch (error) {
      showOperationResultModal({
        success: false,
        title: 'تعذر تحديد الموقع',
        summary: error.message,
      });
    } finally {
      button.disabled = false;
    }
  });
  confirm.addEventListener('click', async () => {
    if (!detectedLocationCandidate || saving) return;
    saving = true;
    confirm.disabled = true;
    cancel.disabled = true;
    errorNode.textContent = '';
    try {
      const res = await window.mihrabApi.saveSettings({ location: detectedLocationCandidate });
      renderSettingsForm(res.config, null);
      await refreshCurrentCountryCities(res.config.location);
      renderPrayerTimes(res.prayerData);
      renderQuranState(res.quranState);
      dialog.close();
      showSuccessFeedback('تم اعتماد الموقع وتحديث المواقيت.');
    } catch (error) {
      errorNode.textContent = error.message;
    } finally {
      saving = false;
      confirm.disabled = false;
      cancel.disabled = false;
    }
  });
}

const settingsDraftBaselines = new Map();
function settingsGroupSnapshot(group) {
  if (group === 'updates') return JSON.stringify(updatePreferencesFromForm());
  if (group === 'performance') return JSON.stringify(getPerformanceSelection());
  if (group === 'resources') return JSON.stringify(resourcePolicyFromForm());
  const nodes =
    group === 'notifications'
      ? [
          ...document.querySelectorAll(
            '#notification-settings input:not([data-select-search]),#notification-settings select',
          ),
        ]
      : ['settings-lock-enabled', 'settings-lock-mute'].map((id) => document.getElementById(id));
  return JSON.stringify(
    nodes.map((node) => [
      node.id,
      node.type === 'checkbox' || node.type === 'radio' ? node.checked : node.value,
    ]),
  );
}
function refreshSettingsDraftStatus() {
  const status = document.getElementById('settings-save-status');
  if (!status) return;
  if (dirtySettingsGroups().length) {
    cancelInlineFeedback(status);
    status.textContent = 'لديك تغييرات لم تُحفظ بعد.';
  } else if (status.textContent === 'لديك تغييرات لم تُحفظ بعد.') {
    cancelInlineFeedback(status);
    status.textContent = '';
  }
}
function resetSettingsDraftBaselines() {
  for (const group of ['notifications', 'screen', 'resources', 'performance', 'updates'])
    settingsDraftBaselines.set(group, settingsGroupSnapshot(group));
}
function dirtySettingsGroups() {
  return ['notifications', 'screen', 'resources', 'performance', 'updates'].filter(
    (group) =>
      settingsDraftBaselines.has(group) &&
      settingsDraftBaselines.get(group) !== settingsGroupSnapshot(group),
  );
}
async function commitSettingsGroups(groups) {
  await quranSaveQueue;
  const snapshots = new Map(groups.map((group) => [group, settingsGroupSnapshot(group)]));
  let patch = groups.includes('notifications') ? collectNotificationSettings() : {};
  if (groups.includes('screen'))
    patch.screenLock = {
      ...patch.screenLock,
      enabled: document.getElementById('settings-lock-enabled').checked,
      muteSystemAudio: document.getElementById('settings-lock-mute').checked,
    };
  if (groups.includes('resources')) patch.network = resourcePolicyFromForm();
  if (groups.includes('updates')) patch.updates = updatePreferencesFromForm();
  if (groups.includes('performance')) patch.performance = { level: getPerformanceSelection() };
  const res = Object.keys(patch).length
    ? await window.mihrabApi.saveSettings(patch)
    : { config: state.config };
  state.config = res.config;
  if (res.performanceProfile) await refreshPerformanceView(res.performanceProfile);
  for (const [group, snapshot] of snapshots) settingsDraftBaselines.set(group, snapshot);
  if (res.quranState) {
    renderQuranSummaries(res.quranState);
    state.quranState = res.quranState;
    renderQuranNotificationShortcuts();
  }
  for (const [group, snapshot] of snapshots) settingsDraftBaselines.set(group, snapshot);
  if (res.prayerData) renderPrayerTimes(res.prayerData);
  if (
    groups.includes('resources') &&
    typeof renderFilteredLessons === 'function' &&
    state.youtubeState
  )
    renderFilteredLessons();
  syncNotificationControls();
  for (const id of ['lock-settings-status']) {
    const node = document.getElementById(id);
    if (node) node.textContent = '';
  }
  return res;
}
let settingsLeaveTarget = null,
  settingsLeaveSaving = false;
function requestSettingsLeave(tabId) {
  settingsLeaveTarget = tabId;
  const dialog = document.getElementById('unsaved-settings-dialog');
  document.getElementById('unsaved-settings-error').textContent = '';
  if (!dialog.open) dialog.showModal();
}
function initializeSettingsLeaveGuard() {
  const dialog = document.getElementById('unsaved-settings-dialog'),
    save = document.getElementById('btn-save-settings-and-leave'),
    stay = document.getElementById('btn-stay-in-settings');
  stay.addEventListener('click', () => {
    if (!settingsLeaveSaving) {
      settingsLeaveTarget = null;
      dialog.close();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (settingsLeaveSaving) event.preventDefault();
    else settingsLeaveTarget = null;
  });
  save.addEventListener('click', async () => {
    if (settingsLeaveSaving) return;
    settingsLeaveSaving = true;
    save.disabled = true;
    stay.disabled = true;
    try {
      const dirty = dirtySettingsGroups();
      if (dirty.length) await commitSettingsGroups(dirty);
      if (dirtySettingsGroups().length)
        throw Error('توجد تعديلات جديدة أثناء الحفظ؛ راجعها ثم أكد الحفظ مجدداً.');
      const target = settingsLeaveTarget;
      settingsLeaveTarget = null;
      dialog.close();
      if (target) activateTabById(target);
    } catch (error) {
      document.getElementById('unsaved-settings-error').textContent = error.message;
    } finally {
      settingsLeaveSaving = false;
      save.disabled = false;
      stay.disabled = false;
    }
  });
}

const resourceViewPreferences = (() => {
  const defaults = { range: 7, section: 'storage' };
  try {
    const saved = JSON.parse(localStorage.getItem('mihrab-resource-view') || 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      range: [1, 7, 30].includes(saved.range) ? saved.range : 7,
      section: saved.section === 'usage' ? 'usage' : 'storage',
      ...(typeof saved.showChart === 'boolean' ? { showChart: saved.showChart } : {}),
    };
  } catch (_) {
    return defaults;
  }
})();
function saveResourceViewPreferences() {
  try {
    localStorage.setItem('mihrab-resource-view', JSON.stringify(resourceViewPreferences));
  } catch (_) {
    briefInlineFeedback(
      document.getElementById('resource-action-status'),
      'تعذر تذكّر طريقة العرض على هذا الجهاز.',
    );
  }
}
function restoreResourceView(config = {}) {
  if (typeof resourceViewPreferences.showChart !== 'boolean') {
    resourceViewPreferences.showChart = config.network?.showChart !== false;
    saveResourceViewPreferences();
  }
  resourceRange = resourceViewPreferences.range;
  document.getElementById('network-show-chart').checked = resourceViewPreferences.showChart;
  for (const button of document.querySelectorAll('[data-usage-range]'))
    button.setAttribute(
      'aria-pressed',
      String(Number(button.dataset.usageRange) === resourceRange),
    );
}

let resourceStats = null,
  resourceRange = resourceViewPreferences.range,
  resourceBusy = false,
  pendingDataDeletion = null;
const resourceCategoryNames = {
  youtube: 'خلاصات يوتيوب والصور والمشاهدة',
  hadith: 'الأحاديث وشروحها',
  prayer: 'مطابقة مواقيت الصلاة',
  location: 'اكتشاف الموقع عبر الإنترنت',
  other: 'الاتصالات الأخرى',
};
function formatResourceBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function resourcePolicyFromForm() {
  return {
    enabled: document.getElementById('network-enabled').checked,
    categories: Object.fromEntries(
      Object.keys(resourceCategoryNames).map((key) => [
        key,
        document.getElementById('network-' + key).checked,
      ]),
    ),
  };
}
function renderResourcePolicy(config) {
  const n = config.network || {};
  document.getElementById('network-enabled').checked = n.enabled !== false;
  restoreResourceView(config);
  for (const key of Object.keys(resourceCategoryNames))
    document.getElementById('network-' + key).checked = n.categories?.[key] !== false;
  syncResourceSettings();
}
function syncResourceSettings() {
  const n = resourcePolicyFromForm();
  document.getElementById('network-category-fields').disabled = !n.enabled;
  document.getElementById('usage-chart').hidden =
    !document.getElementById('network-show-chart').checked;
  const hint = document.getElementById('lesson-network-hint');
  if (hint) hint.hidden = n.enabled && n.categories.youtube;
  renderUsageChart();
}
function resourceAmount(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  return n >= 1048576
    ? (n / 1048576).toFixed(2) + ' MB'
    : (n / 1024).toFixed(n < 1024 ? 2 : 1) + ' KB';
}
function renderStorageComposition(disk) {
  document.getElementById('disk-total').textContent = formatResourceBytes(disk.total);
  const bar = document.getElementById('storage-composition'),
    legend = document.getElementById('storage-legend'),
    tooltip = document.getElementById('storage-tooltip');
  bar.replaceChildren();
  legend.replaceChildren();
  const items = [
    ['application', 'ملفات التطبيق', '#4285f4'],
    ['data', 'البيانات المحفوظة', '#fbbc04'],
    ['profile', 'ملف التشغيل والكاش', '#34a853'],
  ];
  for (const [key, title, color] of items) {
    const bytes = disk[key] || 0,
      text = title + ' — ' + resourceAmount(bytes),
      segment = document.createElement('button');
    segment.type = 'button';
    segment.className = 'storage-segment';
    segment.style.width = (disk.total ? (bytes / disk.total) * 100 : 0) + '%';
    segment.style.background = color;
    segment.title = text;
    segment.setAttribute('aria-label', text);
    segment.dataset.storageKey = key;
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'storage-legend-entry';
    const dot = document.createElement('span');
    dot.style.background = color;
    dot.className = 'storage-legend-dot';
    entry.append(dot, document.createTextNode(title));
    const show = () => {
      tooltip.textContent = text;
      tooltip.hidden = false;
      segment.classList.add('is-highlighted');
    };
    const hide = () => {
      tooltip.hidden = true;
      segment.classList.remove('is-highlighted');
    };
    for (const node of [segment, entry]) {
      node.addEventListener('mouseenter', show);
      node.addEventListener('mouseleave', hide);
      node.addEventListener('focus', show);
      node.addEventListener('blur', hide);
      node.addEventListener('click', show);
    }
    bar.append(segment);
    legend.append(entry);
  }
}
function usageChartSamples(stats, range, now = Date.now()) {
  const hourly = range === 1,
    count = hourly ? 24 : range + 1,
    step = hourly ? 3600000 : 86400000,
    end = Math.floor(now / step) * step;
  const since = new Date(hourly ? stats.hourlySince || stats.since : stats.since).getTime();
  return Array.from({ length: count }, (_, i) => {
    const start = end - (count - 1 - i) * step,
      key = new Date(start).toISOString().slice(0, hourly ? 13 : 10),
      values = (hourly ? stats.hours : stats.days)?.[key] || {},
      known = start + step > since;
    return {
      start,
      end: start + step,
      values,
      total: Object.values(values).reduce((a, b) => a + b, 0),
      known,
      partial: known && start < since,
    };
  });
}
function renderUsageChart() {
  if (!resourceStats) return;
  const samples = usageChartSamples(resourceStats, resourceRange),
    chart = document.getElementById('usage-chart'),
    tooltip = document.getElementById('usage-tooltip');
  chart.replaceChildren();
  chart.style.removeProperty('grid-template-columns');
  tooltip.hidden = true;
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    W = 760,
    H = 240,
    L = 62,
    R = 18,
    T = 18,
    B = 42,
    w = W - L - R,
    h = H - T - B;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('usage-line-svg');
  const make = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text != null) node.textContent = text;
    svg.append(node);
    return node;
  };
  const max = Math.max(1024, ...samples.map((p) => p.total)) * 1.12,
    x = (i) => L + (i * w) / (samples.length - 1),
    y = (v) => T + h - (v / max) * h;
  const defs = make('defs', {}),
    pattern = document.createElementNS(ns, 'pattern');
  pattern.id = 'usage-missing-pattern';
  pattern.setAttribute('width', '8');
  pattern.setAttribute('height', '8');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const stripe = document.createElementNS(ns, 'path');
  stripe.setAttribute('d', 'M-2 2L2 -2M0 8L8 0M6 10L10 6');
  stripe.setAttribute('class', 'usage-missing-stripe');
  pattern.append(stripe);
  defs.append(pattern);
  samples.forEach((p, i) => {
    if (!p.known)
      make('rect', {
        x: Math.max(L, x(i) - w / (samples.length - 1) / 2),
        y: T,
        width:
          Math.min(W - R, x(i) + w / (samples.length - 1) / 2) -
          Math.max(L, x(i) - w / (samples.length - 1) / 2),
        height: h,
        fill: 'url(#usage-missing-pattern)',
      });
  });
  const missing = samples.map((p, i) => (!p.known ? i : -1)).filter((i) => i >= 0);
  if (missing.length)
    make(
      'text',
      {
        x: (x(missing[0]) + x(missing[missing.length - 1])) / 2,
        y: T + 26,
        class: 'usage-no-data',
      },
      'لا توجد بيانات',
    );
  for (let i = 0; i <= 3; i++) {
    const value = (max * i) / 3,
      yy = y(value);
    make('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'usage-grid-line' });
    make(
      'text',
      { x: L - 8, y: yy + 4, 'text-anchor': 'end', class: 'usage-axis-label' },
      resourceAmount(value),
    );
  }
  const paths = { known: '', missing: '' };
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i],
      kind = p.known ? 'known' : 'missing',
      previous = i && samples[i - 1].known === p.known;
    paths[kind] +=
      (previous ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(p.known ? p.total : 0).toFixed(2) + ' ';
  }
  for (const kind of ['missing', 'known'])
    make('path', {
      d: paths[kind],
      class: 'usage-line ' + (kind === 'missing' ? 'usage-line-missing' : ''),
      fill: 'none',
    });
  for (const i of [0, Math.floor(samples.length / 2), samples.length - 1])
    make(
      'text',
      {
        x: x(i),
        y: H - 12,
        'text-anchor': i === 0 ? 'start' : i === samples.length - 1 ? 'end' : 'middle',
        class: 'usage-axis-label',
      },
      new Intl.DateTimeFormat('ar', {
        timeZone: 'UTC',
        ...(resourceRange === 1
          ? { hour: '2-digit', hourCycle: 'h23' }
          : { month: 'short', day: 'numeric' }),
      }).format(new Date(samples[i].start)),
    );
  const guide = make('line', {
      x1: L,
      x2: L,
      y1: T,
      y2: T + h,
      class: 'usage-hover-guide',
      visibility: 'hidden',
    }),
    point = make('circle', {
      cx: L,
      cy: y(0),
      r: 4,
      class: 'usage-hover-point',
      visibility: 'hidden',
    });
  let index = samples.length - 1;
  const show = (i) => {
    index = Math.max(0, Math.min(samples.length - 1, i));
    const p = samples[index];
    guide.setAttribute('x1', x(index));
    guide.setAttribute('x2', x(index));
    guide.setAttribute('visibility', 'visible');
    point.setAttribute('cx', x(index));
    point.setAttribute('cy', y(p.known ? p.total : 0));
    point.setAttribute('visibility', 'visible');
    tooltip.replaceChildren();
    const title = document.createElement('strong');
    title.textContent =
      new Date(p.start).toLocaleString('ar', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        ...(resourceRange === 1 ? { timeStyle: 'short' } : {}),
      }) + ' — UTC';
    tooltip.append(title);
    const total = document.createElement('p');
    total.textContent = p.known
      ? 'الإجمالي: ' + resourceAmount(p.total) + (p.partial ? ' — بدأ القياس خلال هذه الفترة' : '')
      : 'لا توجد بيانات مسجلة لهذه الفترة؛ الصفر المعروض ليس قياساً فعلياً.';
    tooltip.append(total);
    for (const [key, label] of Object.entries(resourceCategoryNames)) {
      const row = document.createElement('p');
      row.textContent = label + ': ' + (p.known ? resourceAmount(p.values[key] || 0) : 'غير مسجل');
      tooltip.append(row);
    }
    tooltip.hidden = false;
  };
  samples.forEach((p, i) => {
    const width = w / (samples.length - 1);
    const target = make('rect', {
      x: Math.max(L, x(i) - width / 2),
      y: T,
      width: i === 0 || i === samples.length - 1 ? width / 2 : width,
      height: h,
      fill: 'transparent',
      class: 'usage-point-hit',
      'data-usage-index': i,
    });
    target.addEventListener('pointerenter', () => show(i));
    target.addEventListener('click', () => show(i));
  });
  chart.append(svg);
  chart.onpointerleave = () => {
    tooltip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
    point.setAttribute('visibility', 'hidden');
  };
  chart.onblur = () => {
    tooltip.hidden = true;
  };
  chart.onkeydown = (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      show(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? samples.length - 1
            : index + (event.key === 'ArrowRight' ? 1 : -1),
      );
    }
  };
  chart.onfocus = () => show(index);
  const total = samples.reduce((sum, p) => sum + p.total, 0);
  document.getElementById('usage-total').textContent =
    (resourceRange === 1 ? 'استهلاك آخر 24 ساعة: ' : 'استهلاك المدة المعروضة: ') +
    resourceAmount(total);
  document.getElementById('usage-coverage-note').textContent =
    'التوقيت العالمي UTC. الأجزاء المخططة تعني عدم وجود سجل سابق، وتُعرض عند الصفر دون اعتبارها استهلاكاً مقاساً.';
  const host = document.getElementById('usage-categories');
  host.replaceChildren();
  for (const [key, label] of Object.entries(resourceCategoryNames)) {
    const row = document.createElement('p');
    row.textContent =
      label + ': ' + resourceAmount(samples.reduce((sum, p) => sum + (p.values[key] || 0), 0));
    host.append(row);
  }
}
let networkChangeAcknowledged = false,
  pendingNetworkChange = null;
function initializeResourceHelp() {
  for (const button of document.querySelectorAll('[data-network-policy]'))
    button.addEventListener('click', () =>
      document.getElementById('network-policy-dialog').showModal(),
    );
  for (const button of document.querySelectorAll('[data-youtube-explanation]'))
    button.addEventListener('click', () =>
      document.getElementById('youtube-explanation-dialog').showModal(),
    );
  for (const button of document.querySelectorAll('[data-close-resource-dialog]'))
    button.addEventListener('click', () => button.closest('dialog').close());
  const warning = document.getElementById('network-first-change-dialog');
  document.querySelector('.resource-advanced').addEventListener(
    'click',
    (event) => {
      const input = event.target;
      if (networkChangeAcknowledged || input.tagName !== 'INPUT' || input.type !== 'checkbox')
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingNetworkChange = { input, value: input.checked };
      warning.showModal();
    },
    true,
  );
  document.getElementById('btn-accept-network-change').addEventListener('click', () => {
    networkChangeAcknowledged = true;
    const pending = pendingNetworkChange;
    pendingNetworkChange = null;
    warning.close();
    if (pending) {
      pending.input.checked = pending.value;
      pending.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  document.getElementById('btn-cancel-network-change').addEventListener('click', () => {
    pendingNetworkChange = null;
    warning.close();
  });
  warning.addEventListener('cancel', () => {
    pendingNetworkChange = null;
  });
}

async function refreshResourceStats() {
  if (resourceBusy) return;
  resourceBusy = true;
  const status = document.getElementById('resource-action-status');
  status.textContent = 'جارٍ حساب المساحة…';
  try {
    resourceStats = await window.mihrabApi.getResourceStats();
    renderStorageComposition(resourceStats.disk);
    document.getElementById('memory-used').textContent = formatResourceBytes(resourceStats.memory);
    document.getElementById('usage-since').textContent =
      'بدأ القياس في ' +
      new Date(resourceStats.since).toLocaleString('ar') +
      '. الأرقام تقديرية للبيانات التي يمكن قياسها؛ ';
    if (resourceStats.unknownResponses)
      document.getElementById('usage-since').textContent +=
        ' استجابات دون حجم معلن: ' + resourceStats.unknownResponses;
    renderUsageChart();
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    resourceBusy = false;
  }
}
function initializeResourceSettings() {
  initializeResourceHelp();
  document
    .querySelector('[data-settings-section=resources]')
    .addEventListener('click', refreshResourceStats);
  document.getElementById('btn-refresh-resources').addEventListener('click', refreshResourceStats);
  document.getElementById('network-show-chart').addEventListener('change', () => {
    resourceViewPreferences.showChart = document.getElementById('network-show-chart').checked;
    saveResourceViewPreferences();
    syncResourceSettings();
  });
  document.getElementById('resource-general-settings').addEventListener('change', (event) => {
    if (!event.target.matches('.resource-advanced input[type=checkbox]')) return;
    syncResourceSettings();
    refreshSettingsDraftStatus();
  });
  document.querySelectorAll('[data-usage-range]').forEach((button) =>
    button.addEventListener('click', () => {
      resourceRange = Number(button.dataset.usageRange);
      resourceViewPreferences.range = resourceRange;
      saveResourceViewPreferences();
      for (const b of document.querySelectorAll('[data-usage-range]'))
        b.setAttribute('aria-pressed', String(b === button));
      renderUsageChart();
    }),
  );
  document.getElementById('btn-clear-resource-cache').addEventListener('click', async (event) => {
    const b = event.currentTarget;
    b.disabled = true;
    try {
      await window.mihrabApi.clearResourceCache();
      await refreshResourceStats();
      briefInlineFeedback(document.getElementById('resource-action-status'), 'تم مسح كاش الشبكة.');
    } catch (error) {
      document.getElementById('resource-action-status').textContent = error.message;
    } finally {
      b.disabled = false;
    }
  });
  const deletion = document.getElementById('resource-delete-dialog');
  document.getElementById('btn-delete-resource-data').addEventListener('click', () => {
    pendingDataDeletion = document.getElementById('resource-data-kind').value;
    document.getElementById('resource-delete-error').textContent = '';
    document.getElementById('resource-delete-description').textContent = {
      youtube:
        'ستُحذف المقاطع والتصنيفات المحفوظة. تبقى اشتراكات القنوات. تحتاج شبكة لجلبها مجدداً.',
      hadith:
        'ستُحذف الأحاديث التي جلبتها وسجل عرضها، وتستعاد مكتبة الأحاديث الأساسية المرفقة بالتطبيق.',
      cities: 'ستُحذف مواقيت المدن السابقة المحفوظة. تبقى إعدادات المدينة الحالية.',
      history: 'سيُحذف سجل استهلاك الإنترنت، ويبدأ القياس من جديد.',
    }[pendingDataDeletion];
    deletion.showModal();
  });
  document
    .getElementById('btn-cancel-resource-delete')
    .addEventListener('click', () => deletion.close());
  document
    .getElementById('btn-confirm-resource-delete')
    .addEventListener('click', async (event) => {
      const b = event.currentTarget;
      b.disabled = true;
      try {
        const result = await window.mihrabApi.deleteResourceData(pendingDataDeletion);
        if (result.feeds) renderYoutubeState(result.feeds);
        if (result.hadithState) {
          renderHadithState(result.hadithState);
          hadithLibraryLoaded = false;
          if (typeof loadHadithLibrary === 'function') await loadHadithLibrary(0);
        }
        deletion.close();
        await refreshResourceStats();
        briefInlineFeedback(
          document.getElementById('resource-action-status'),
          'تم حذف البيانات المحددة.',
        );
      } catch (error) {
        document.getElementById('resource-delete-error').textContent = error.message;
      } finally {
        b.disabled = false;
      }
    });
}

window.mihrabPerformance = {
  selection: 'auto',
  recommended: 'full',
  hardware: null,
  profile: {
    id: 'full',
    title: 'كامل',
    batchSize: 8,
    images: true,
    paged: false,
    animations: true,
  },
};
let pendingPerformanceLevel = null,
  lastPerformanceDraft = 'auto';
function getPerformanceSelection() {
  return document.getElementById('performance-auto').checked
    ? 'auto'
    : document.querySelector('[name=performance-level]:checked')?.value || 'auto';
}
function setPerformanceChoice(level) {
  document.getElementById('performance-auto').checked = level === 'auto';
  for (const input of document.querySelectorAll('[name=performance-level]'))
    input.checked =
      input.value === (level === 'auto' ? window.mihrabPerformance.recommended : level);
}
function applyPerformanceProfile(value) {
  window.mihrabPerformance = value;
  document.documentElement.dataset.performance = value.profile.id;
  lastPerformanceDraft = value.selection;
  setPerformanceChoice(value.selection);
  for (const badge of document.querySelectorAll('[data-performance-recommendation]'))
    badge.hidden = badge.dataset.performanceRecommendation !== value.recommended;
  const hw = value.hardware;
  document.getElementById('performance-cpu').textContent =
    'المعالج: ' + (hw?.processor || 'غير معروف');
  document.getElementById('performance-memory').textContent =
    'الذاكرة المؤقتة (RAM): ' + (hw ? hw.memoryGB + ' GB' : 'غير معروفة');
  document.getElementById('performance-cores').textContent =
    'الأنوية: ' +
    (hw
      ? hw.logicalCores +
        ' خيوط معالجة — متوسط سرعة الخيوط: ' +
        (hw.cpuMHz ? (hw.cpuMHz / 1000).toFixed(2) + ' GHz' : 'غير متاح')
      : 'غير معروفة');
  if (!value.profile.animations)
    document.querySelectorAll('.scroll-item').forEach((node) => node.classList.add('is-visible'));
}
async function refreshPerformanceView(result) {
  applyPerformanceProfile(result);
  if (lessonFeed) {
    lessonFeed.dispose();
    lessonFeed = null;
  }
  lessonSource = null;
  lessonFilterKey = null;
  try {
    renderYoutubeState(await window.mihrabApi.getYoutubeState());
  } catch (error) {
    document.getElementById('performance-status').textContent =
      'حُفظ المستوى، لكن تعذر تحديث الدروس: ' + error.message;
  }
}
function markPerformanceDraft() {
  const status = document.getElementById('settings-save-status');

  status.textContent = 'لديك تغييرات لم تُحفظ بعد.';
}
function initializePerformance(value) {
  applyPerformanceProfile(value || window.mihrabPerformance);
  const rank = { eco: 0, balanced: 1, full: 2 },
    dialog = document.getElementById('performance-warning-dialog');
  const request = (level) => {
    setPerformanceChoice(level);
    const old =
      lastPerformanceDraft === 'auto' ? window.mihrabPerformance.recommended : lastPerformanceDraft;
    if (
      level !== 'auto' &&
      rank[level] > rank[window.mihrabPerformance.recommended] &&
      rank[level] > rank[old]
    ) {
      pendingPerformanceLevel = level;
      dialog.showModal();
    } else {
      lastPerformanceDraft = level;
      markPerformanceDraft();
    }
  };
  for (const input of document.querySelectorAll('[name=performance-level]'))
    input.addEventListener('change', () => request(input.value));
  document
    .getElementById('performance-auto')
    .addEventListener('change', (event) =>
      request(
        event.target.checked
          ? 'auto'
          : document.querySelector('[name=performance-level]:checked').value,
      ),
    );
  document.getElementById('btn-confirm-performance').addEventListener('click', () => {
    if (pendingPerformanceLevel) {
      lastPerformanceDraft = pendingPerformanceLevel;
      markPerformanceDraft();
    }
    pendingPerformanceLevel = null;
    dialog.close();
  });
  const cancel = () => {
    pendingPerformanceLevel = null;
    setPerformanceChoice(lastPerformanceDraft);
  };
  document.getElementById('btn-cancel-performance').addEventListener('click', () => {
    cancel();
    dialog.close();
  });
  dialog.addEventListener('cancel', cancel);
}

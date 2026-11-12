/** Mihrab renderer: UI interactions and dynamic theme variables. */

const state = {
  config: null,
  themeState: null,
  prayerData: null,
  hadithState: null,
  quranState: null,
  youtubeState: null,
  selectedChannelIds: new Set(),
  selectedContextIds: new Set(),
  cities: [],
  countries: [],
  citiesByCountry: new Map(),
  locationRequestId: 0,
  locationBusy: false,
  methodManuallySelected: false,
  pendingDeleteChannel: null,
  extraModalUrl: null,
  clockTimerId: null,
  youtubeRefreshPromise: null,
  youtubeRefreshStarted: false,
  recommendedVideoId: null,
  pendingNavigationTarget: null,
};

// A single observer for dynamic cards; no scroll handlers or polling timers.
const uiMotion = (() => {
  const selector =
    '.hadith-library-card,.quran-boundary,.hadith-vocabulary-item,.lesson-card,.video-card,.prayer-item-card';
  const pending = new Set(),
    preference = matchMedia('(prefers-reduced-motion: reduce)');
  let observer, mutations;
  const register = (node, initial = false) => {
    if (!(node instanceof Element)) return;
    const cards = [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
    for (const card of cards) {
      if (!card.isConnected || !card.parentElement) continue;
      if (card.closest('.quran-book-spread')) continue;
      if (card.matches('.prayer-item-card')) {
        card.classList.add('scroll-view');
        continue;
      }
      if (card.classList.contains('scroll-item')) continue;
      card.classList.add('scroll-item');
      card.style.setProperty(
        '--item-index',
        String(Array.prototype.indexOf.call(card.parentElement.children, card) % 6),
      );
      if (preference.matches || !observer) card.classList.add('is-visible');
      else {
        pending.add(card);
        observer.observe(card);
      }
    }
    if (initial)
      node.querySelectorAll('.prayer-card').forEach((card) => card.classList.add('scroll-view'));
  };
  const revealAll = () => {
    if (preference.matches)
      for (const card of pending) {
        card.classList.add('is-visible');
        observer.unobserve(card);
      }
    if (preference.matches) pending.clear();
  };
  return {
    init() {
      if (typeof IntersectionObserver === 'function')
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
                pending.delete(entry.target);
              }
          },
          { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
        );
      document.documentElement.dataset.motion = 'enabled';
      register(document.querySelector('.main-content'), true);
      mutations = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) register(node);
        for (const card of pending)
          if (!card.isConnected) {
            observer.unobserve(card);
            pending.delete(card);
          }
      });
      mutations.observe(document.querySelector('.main-content'), {
        childList: true,
        subtree: true,
      });
      preference.addEventListener('change', revealAll);
    },
    dispose() {
      observer?.disconnect();
      mutations?.disconnect();
      pending.clear();
      preference.removeEventListener('change', revealAll);
    },
    get pendingCount() {
      return pending.size;
    },
  };
})();

let feedbackTimer;
function conciseFeedback(text) {
  return String(text || '')
    .replace(/[✅❌ℹ️]/gu, '')
    .replace(/Error invoking remote method '[^']+':\s*Error:\s*/g, '')
    .trim();
}
function showSuccessFeedback(message) {
  let host = document.getElementById('action-feedback');
  if (!host) {
    host = document.createElement('div');
    host.id = 'action-feedback';
    host.setAttribute('role', 'status');
    host.setAttribute('popover', 'manual');
    document.body.append(host);
  }
  host.textContent = conciseFeedback(message);
  if (!host.matches(':popover-open')) host.showPopover();
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    if (host.matches(':popover-open')) host.hidePopover();
  }, 7000);
}
function briefInlineFeedback(node, message) {
  if (node) node.textContent = '';
  showSuccessFeedback(message);
}

// ============================================================================
// Operation results with explicit success and error details.
// ============================================================================
function showOperationResultModal({ success, title, summary, details, extraUrl = null }) {
  summary = conciseFeedback(summary);
  if (
    success &&
    !extraUrl &&
    !/تعذر|فشل|تحذير|غير متاح/.test(String(details || '')) &&
    !/التحقق من أوقات الصلاة/.test(title || '')
  ) {
    showSuccessFeedback(summary || title);
    return;
  }
  const modal = document.getElementById('modal-operation-result');
  const badge = document.getElementById('op-modal-badge');
  const titleEl = document.getElementById('op-modal-title');
  const summaryEl = document.getElementById('op-modal-summary');
  const detailsEl = document.getElementById('op-modal-details');
  const extraBtn = document.getElementById('btn-op-modal-extra-link');

  if (badge) {
    badge.className = `status-modal-badge ${success ? 'success' : 'error'}`;
    badge.textContent = success ? 'تمت العملية' : 'تعذر إكمال العملية';
  }

  if (titleEl) titleEl.textContent = title || (success ? 'نجاح العملية' : 'خطأ في العملية');
  if (summaryEl) summaryEl.textContent = summary || '';
  if (detailsEl) {
    detailsEl.textContent =
      typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details || '');
  }

  if (detailsEl) {
    let disclosure = detailsEl.closest('.operation-extra-details');
    if (!disclosure) {
      disclosure = document.createElement('details');
      disclosure.className = 'operation-extra-details';
      const label = document.createElement('summary');
      label.textContent = 'التفاصيل';
      detailsEl.before(disclosure);
      disclosure.append(label, detailsEl);
    }
    disclosure.hidden = !detailsEl.textContent;
    disclosure.open = !success;
  }
  state.extraModalUrl = extraUrl;
  if (extraBtn) {
    extraBtn.style.display = extraUrl ? 'inline-flex' : 'none';
  }

  if (modal) modal.classList.add('open');
}

function activateTabById(tabId) {
  if (
    tabId !== 'tab-settings' &&
    document.getElementById('tab-settings').classList.contains('active') &&
    document.getElementById(tabId)?.classList.contains('tab-section') &&
    dirtySettingsGroups().length
  ) {
    requestSettingsLeave(tabId);
    return;
  }
  closeInlineSettings();
  if (tabId === 'tab-hadith' && !hadithLibraryLoaded) loadHadithLibrary(0);
  if (!document.getElementById(tabId)?.classList.contains('tab-section')) return;
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === tabId;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document
    .querySelectorAll('.tab-section')
    .forEach((section) => section.classList.toggle('active', section.id === tabId));
  recordShortcutTab(tabId);
  document.querySelector('.main-content').scrollTo({ top: 0, behavior: 'instant' });
  if (tabId === 'tab-youtube') {
    renderFilteredLessons();
    ensureYoutubeRefresh();
  } else if (lessonFeed) lessonFeed.setActive(false);
}

let navigationToggleAnchor = null,
  navigationToggleMotion = null;
function setNavigationMode(mode, persist = true) {
  const navButton = document.getElementById('btn-navigation-mode');
  const before = (navigationToggleMotion?.ghost || navButton).getBoundingClientRect();
  if (navigationToggleMotion) {
    navigationToggleMotion.animation?.cancel();
    navigationToggleMotion.ghost.remove();
    navigationToggleMotion = null;
  }
  navButton.style.removeProperty('visibility');
  const duration = motionDuration(),
    ghost = persist && duration ? navButton.cloneNode(true) : null;
  const sidebar = mode === 'sidebar';
  const selected = sidebar ? 'sidebar' : 'dock';
  document.body.dataset.navigation = selected;
  document.querySelector('.app-shell').dataset.navigation = selected;
  const panel = document.getElementById('classic-sidebar');
  panel.inert = !sidebar;
  panel.setAttribute('aria-hidden', String(!sidebar));
  document.getElementById('floating-dock').hidden = sidebar;
  const toggle = document.getElementById('btn-navigation-mode');
  // Reuse the same control and listeners in the header; restore its dock anchor.
  if (!navigationToggleAnchor) {
    navigationToggleAnchor = document.createComment('navigation-toggle-anchor');
    toggle.before(navigationToggleAnchor);
  }
  if (sidebar) document.getElementById('sidebar-layout-slot').append(toggle);
  else navigationToggleAnchor.after(toggle);
  const label = sidebar ? 'الشريط العائم' : 'القائمة الجانبية';
  toggle.setAttribute('aria-expanded', String(sidebar));
  toggle.setAttribute('aria-label', `التبديل إلى ${label}`);
  toggle.querySelector('.control-tooltip').textContent = label;
  toggle.querySelector('[data-layout-icon="sidebar"]').hidden = sidebar;
  toggle.querySelector('[data-layout-icon="dock"]').hidden = !sidebar;
  if (ghost) {
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelector('.control-tooltip')?.remove();
    Object.assign(ghost.style, {
      position: 'fixed',
      left: before.left + 'px',
      top: before.top + 'px',
      right: 'auto',
      bottom: 'auto',
      width: before.width + 'px',
      height: before.height + 'px',
      zIndex: 3000,
      margin: 0,
      transition: 'none',
      pointerEvents: 'none',
    });
    document.body.append(ghost);
    navButton.style.visibility = 'hidden';
    const job = { ghost, animation: null };
    navigationToggleMotion = job;
    const finish = () => {
      ghost.remove();
      if (navigationToggleMotion === job) {
        navigationToggleMotion = null;
        navButton.style.removeProperty('visibility');
      }
    };
    requestAnimationFrame(() => {
      if (navigationToggleMotion !== job) return;
      if (!motionDuration()) {
        finish();
        return;
      }
      const after = navButton.getBoundingClientRect();
      const shift = sidebar
        ? new DOMMatrixReadOnly(
            getComputedStyle(document.getElementById('classic-sidebar')).transform,
          ).m41
        : 0;
      job.animation = ghost.animate(
        [
          { transform: 'translate(0,0)' },
          {
            transform: `translate(${after.left - before.left - shift}px,${after.top - before.top}px)`,
          },
        ],
        { duration, easing: 'cubic-bezier(.16,1,.3,1)' },
      );
      job.animation.finished.catch(() => {}).finally(finish);
    });
  }
  if (persist) {
    try {
      localStorage.setItem('mihrab-navigation-mode', selected);
    } catch (_) {}
  }
}

function initializeNavigation() {
  let saved = 'dock';
  try {
    saved = localStorage.getItem('mihrab-navigation-mode') || 'dock';
  } catch (_) {}
  setNavigationMode(saved, false);
  document.getElementById('btn-navigation-mode').addEventListener('click', () => {
    setNavigationMode(document.body.dataset.navigation === 'dock' ? 'sidebar' : 'dock');
  });
  const dockTabs = [...document.querySelectorAll('.dock-tabs [data-tab]')];
  document.getElementById('floating-dock').addEventListener('keydown', (event) => {
    const index = dockTabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? dockTabs.length - 1
          : (index + (event.key === 'ArrowLeft' ? 1 : -1) + dockTabs.length) % dockTabs.length;
    dockTabs[next].focus();
    activateTabById(dockTabs[next].dataset.tab);
  });
}

// ============================================================================
// 1. Theme CSS variable injection.
// ============================================================================
function applyThemeStateToDom(themeState) {
  document.documentElement.dataset.theme = themeState?.activeTheme || '';
  if (!themeState) return;
  document.documentElement.dataset.activeColorMode = themeState.activeMode;
  state.themeState = themeState;

  const root = document.documentElement;
  const vars = themeState.cssVariables || {};
  for (const [prop, val] of Object.entries(vars)) {
    root.style.setProperty(prop, val);
  }

  const selector = document.getElementById('theme-selector');
  const modernEnabled = themeState.activeTheme !== 'classic-monochrome';
  document.getElementById('theme-modern-enabled').checked = modernEnabled;
  document.getElementById('modern-theme-options').hidden = !modernEnabled;
  const modernThemes = (themeState.availableThemes || []).filter(theme => theme.family !== 'classic');
  if (modernEnabled && modernThemes.some(theme => theme.id === themeState.activeTheme)) {
    localStorage.setItem('mihrab.lastModernTheme', themeState.activeTheme);
  }
  selector.replaceChildren(...modernThemes.map(theme => new Option(theme.name, theme.id)));
  if (modernEnabled) selector.value = themeState.activeTheme;

  document.querySelectorAll('[data-color-mode]').forEach((button) => {
    const active = button.dataset.colorMode === themeState.activeMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

// ============================================================================
// 2. Prayer times, countdown and Friday presentation.
// ============================================================================
function renderPrayerTimes(prayerData) {
  if (!prayerData) return;
  state.prayerData = prayerData;
  renderVerificationStatus(prayerData.verification);
  renderLastPrayerUpdate(prayerData.lastTimingUpdate);
  const cityEl = document.getElementById('top-city-name');
  if (cityEl && prayerData.location) {
    const cityName = prayerData.location.city || '';
    const countryName = prayerData.location.country || '';
    cityEl.textContent = countryName ? `${cityName}، ${countryName}` : cityName;
  }


  const nextP = MihrabPrayerDisplay.select(prayerData)?.prayer;

  const grid = document.getElementById('prayers-grid-container');
  if (grid && Array.isArray(prayerData.prayers)) {
    grid.innerHTML = '';
    for (const p of prayerData.prayers) {
      const card = document.createElement('div');
      const isNext = nextP && nextP.id === p.id;
      card.dataset.prayerId = p.id;
      card.className = `prayer-item-card${isNext ? ' next-active' : ''}`;

      const adjVal = Number(p.adjustment) || 0;
      const adjText = adjVal === 0 ? 'دون تعديل' : `${adjVal > 0 ? '+' : ''}${adjVal} دقيقة`;

      card.innerHTML = `
        <div class="prayer-name">${p.name}</div>
        <div class="prayer-time">${p.time12}</div>
        <div style="font-size: var(--font-size-xs); color: var(--text-muted);">${p.time24}</div>
        <span class="prayer-adj-badge">${adjText}</span>
      `;
      addPrayerNoticeButton(card, p, prayerData.isFriday);
      grid.appendChild(card);
    }
  }
  updateLiveClockAndCountdown();
}

function renderPrayerHero(display) {
  const text = (id, value) => {
    const node = document.getElementById(id);
    if (node && node.textContent !== value) node.textContent = value;
  };
  if (!display) {
    text('hero-next-label', 'مواقيت الصلاة');
    text('hero-next-name', 'الموعد غير متاح');
    text('hero-countdown', '--:--:--');
    text('hero-pre-alert-info', 'راجع إعدادات المنطقة وطريقة الحساب.');
    return;
  }
  const prayer = display.prayer,
    elapsed = display.mode === 'elapsed',
    data = state.prayerData;
  text('hero-next-label', elapsed ? 'مضى على الأذان' : 'الصلاة القادمة');
  text('hero-next-name', prayer.name);
  text('hero-countdown', (elapsed ? '+' : '−') + MihrabPrayerDisplay.clock(display.seconds));
  document.getElementById('hero-countdown').dataset.mode = display.mode;
  if (elapsed) text('hero-pre-alert-info', 'يُعرض الموعد التالي بعد مرور 20 دقيقة على الأذان.');
  else {
    const friday = data.isFriday && prayer.id === 'dhuhr';
    const notice = state.config?.notifications || {},
      override = notice.prePrayerOverrides?.[prayer.id];
    const minutes = friday
      ? Math.max(30, Number(notice.fridayPrePrayerMinutes) || 60)
      : Number(override?.minutes ?? notice.prePrayerMinutes) || 15;
    const enabled =
      notice.prePrayerEnabled !== false &&
      (friday ? notice.fridayPrePrayerEnabled !== false : override?.enabled !== false);
    text(
      'hero-pre-alert-info',
      state.config?.screenLock?.enabled
        ? `شاشة التهيئة قبل الصلاة بـ ${state.config.screenLock.minutesBeforeAdhan} دقيقة`
        : enabled
          ? `التنبيه قبل ${prayer.name} بـ ${minutes} دقيقة`
          : 'التنبيه القبلي لهذه الصلاة متوقف',
    );
  }
  const art = document.getElementById('hero-sun-art');
  if (art && art.dataset.prayer !== prayer.id) {
    art.dataset.prayer = prayer.id;
    art.style.backgroundImage = `url('./assets/sun/${['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(prayer.id) ? prayer.id : 'fajr'}.png')`;
  }
  for (const card of document.querySelectorAll('#prayers-grid-container .prayer-item-card'))
    card.classList.toggle('next-active', card.dataset.prayerId === prayer.id);
}

function resumeVisibleClock() {
  if (state.clockTimerId) clearInterval(state.clockTimerId);
  state.clockTimerId = null;
  if (!document.hidden) {
    updateLiveClockAndCountdown();
    state.clockTimerId = setInterval(updateLiveClockAndCountdown, 1000);
  }
}
document.addEventListener('visibilitychange', resumeVisibleClock);

function updateLiveClockAndCountdown(now = new Date()) {
  checkAdhkarCycle(now);
  const clockEl = document.getElementById('live-clock');
  if (clockEl) {
    clockEl.textContent = new Intl.DateTimeFormat('en-GB', {
      timeZone:
        state.prayerData?.location?.effectiveTimeZone || state.prayerData?.location?.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(now);
  }

  renderPrayerHero(MihrabPrayerDisplay.select(state.prayerData, now));
}

// ============================================================================
// 3. Hadith display and fingerprint history.
// ============================================================================

let hadithLibraryRequest = 0,
  hadithLibraryOffset = 0,
  hadithLibraryNext = null,
  hadithLibraryLoaded = false,
  hadithSearchTimer = null;
function createHadithSourceLink(hadith, label = 'عرض الحديث في المصدر') {
  const id = String(hadith?.id || '').match(/^hadeethenc_(\d+)$/)?.[1];
  if (!id) return null;
  const link = document.createElement('a');
  link.className = 'hadith-source-link';
  link.href = 'https://hadeethenc.com/ar/browse/hadith/' + id;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.dataset.sourceKey = hadith.fingerprint || hadith.id;
  link.setAttribute('aria-label', label + ' — HadeethEnc.com، يفتح في المتصفح');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(name, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute(
    'd',
    'M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  );
  svg.append(path);
  const title = document.createElement('span');
  title.textContent = label;
  link.append(svg, title);
  return link;
}

function renderHadithSharh(sharh, changed) {
  const accordion = document.getElementById('hadith-sharh');
  accordion.hidden = !sharh;
  if (changed) accordion.open = false;
  for (const id of ['hadith-vocabulary', 'hadith-benefits'])
    document.getElementById(id).replaceChildren();
  document.getElementById('hadith-explanation').textContent = sharh?.explanation || '';
  const vocab = sharh?.vocabulary || [],
    benefits = sharh?.benefits || [];
  document.getElementById('hadith-vocabulary-section').hidden = !vocab.length;
  document.getElementById('hadith-explanation-section').hidden = !sharh?.explanation;
  document.getElementById('hadith-benefits-section').hidden = !benefits.length;
  for (const item of vocab) {
    const pill = document.createElement('div');
    pill.className = 'hadith-vocabulary-item';
    const term = document.createElement('strong'),
      meaning = document.createElement('span');
    term.textContent = item.word;
    meaning.textContent = item.meaning;
    pill.append(term, meaning);
    document.getElementById('hadith-vocabulary').append(pill);
  }
  for (const benefit of benefits) {
    const li = document.createElement('li');
    li.textContent = benefit;
    document.getElementById('hadith-benefits').append(li);
  }
  const source = document.getElementById('hadith-sharh-source');
  source.replaceChildren();
  if (state.hadithState?.hadith) {
    const label = document.createElement('span');
    label.textContent = 'الناشر والمصدر: موسوعة الأحاديث النبوية — HadeethEnc.com';
    source.append(label);
    const link = createHadithSourceLink(state.hadithState?.hadith, 'صفحة الحديث وشرحه');
    if (link) source.append(link);
  }
}
async function loadHadithLibrary(offset = 0) {
  const request = ++hadithLibraryRequest,
    query = document.getElementById('hadeethenc-topic-input').value;
  const status = document.getElementById('hadith-library-status');
  status.textContent = 'جارٍ البحث في المكتبة…';
  document.getElementById('hadith-library-prev').disabled = true;
  document.getElementById('hadith-library-next').disabled = true;
  try {
    const result = await window.mihrabApi.getHadithLibrary({
      query,
      offset,
      limit: window.mihrabPerformance.profile.id === 'eco' ? 12 : 24,
    });
    if (request !== hadithLibraryRequest) return;
    hadithLibraryOffset = result.offset;
    hadithLibraryNext = result.nextOffset;
    hadithLibraryLoaded = true;
    const grid = document.getElementById('hadith-library-grid');
    grid.replaceChildren();
    for (const item of result.items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hadith-library-card';
      card.dataset.hadithKey = item.fingerprint || item.id;
      card.setAttribute(
        'aria-pressed',
        String(item.fingerprint === state.hadithState?.hadith?.fingerprint),
      );
      const quote = document.createElement('span');
      quote.className = 'hadith-library-preview';
      quote.textContent = item.text;
      const meta = document.createElement('small');
      meta.textContent = [item.grade, item.book].filter(Boolean).join(' — ');
      if (item.hasSharh) {
        const badge = document.createElement('span');
        badge.className = 'hadith-explained-badge';
        badge.textContent = 'مع شرح موثّق';
        card.append(badge);
      }
      card.append(quote, meta);
      const itemHost = document.createElement('article');
      itemHost.className = 'hadith-library-item';
      itemHost.append(card);
      grid.append(itemHost);
    }
    status.textContent = result.total
      ? 'عدد النتائج: ' + result.total
      : 'لا توجد أحاديث تطابق البحث.';
    document.getElementById('hadith-library-page').textContent = result.total
      ? 'عرض ' +
        (result.offset + 1) +
        '–' +
        Math.min(result.offset + result.items.length, result.total) +
        ' من ' +
        result.total
      : '';
    document.getElementById('hadith-library-prev').disabled = result.offset === 0;
    document.getElementById('hadith-library-next').disabled = result.nextOffset === null;
    document.getElementById('hadith-library-scroll').scrollTop = 0;
  } catch (error) {
    if (request === hadithLibraryRequest)
      status.textContent = 'تعذر تحميل المكتبة: ' + error.message;
  }
}
function bindHadithLibraryEvents() {
  for (const action of ['click', 'auxclick'])
    document.getElementById('tab-hadith').addEventListener(action, async (event) => {
      if (action === 'auxclick' && event.button !== 1) return;
      const link = event.target.closest('.hadith-source-link');
      if (!link) return;
      event.preventDefault();
      try {
        await window.mihrabApi.openHadithSource(link.dataset.sourceKey);
      } catch (error) {
        showOperationResultModal({
          success: false,
          title: 'تعذر فتح المصدر',
          summary: conciseFeedback(error.message),
        });
      }
    });
  document
    .getElementById('btn-refresh-hadith-details')
    .addEventListener('click', () => loadHadithDetails(true));
  document.getElementById('hadeethenc-topic-input').addEventListener('input', () => {
    clearTimeout(hadithSearchTimer);
    hadithSearchTimer = setTimeout(() => loadHadithLibrary(0), 120);
  });
  document
    .getElementById('hadith-library-prev')
    .addEventListener('click', () =>
      loadHadithLibrary(
        Math.max(
          0,
          hadithLibraryOffset - (window.mihrabPerformance.profile.id === 'eco' ? 12 : 24),
        ),
      ),
    );
  document.getElementById('hadith-library-next').addEventListener('click', () => {
    if (hadithLibraryNext !== null) loadHadithLibrary(hadithLibraryNext);
  });
  document.getElementById('hadith-library-grid').addEventListener('click', async (event) => {
    const card = event.target.closest('[data-hadith-key]');
    if (!card) return;
    card.disabled = true;
    try {
      const updated = await window.mihrabApi.selectStoredHadith(card.dataset.hadithKey);
      renderHadithState(updated);
      document
        .getElementById('hadith-main-card')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showOperationResultModal({
        success: false,
        title: 'تعذر عرض الحديث',
        summary: error.message,
      });
    } finally {
      card.disabled = false;
    }
  });
  for (const [id, action] of [
    ['btn-copy-hadith', 'copyHadith'],
    ['btn-export-hadith', 'previewHadithImage'],
  ]) {
    document.getElementById(id).addEventListener('click', async (event) => {
      const button = event.currentTarget,
        hadith = state.hadithState?.hadith,
        status = document.getElementById('hadith-action-status');
      if (!hadith) return;
      button.disabled = true;

      status.textContent = '';
      try {
        if (action === 'previewHadithImage') {
          await previewHadithImage(hadith.fingerprint || hadith.id);
          return;
        }
        const result = await window.mihrabApi[action](hadith.fingerprint || hadith.id);
        briefInlineFeedback(
          status,
          result.canceled ? 'أُلغي الحفظ.' : result.saved ? 'تم تحميل الصورة.' : 'تم نسخ الحديث.',
        );
      } catch (error) {
        console.error(error);
        status.textContent = /ENOENT/.test(error.message)
          ? 'تعذر الحفظ. اختر مجلداً موجوداً ثم أعد المحاولة.'
          : 'تعذرت العملية: ' + conciseFeedback(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }
}

let hadithDetailsRequest = 0,
  hadithDetailsKey = null;
async function loadHadithDetails(force = false) {
  const hadith = state.hadithState?.hadith,
    key = hadith?.fingerprint || hadith?.id;
  if (!key) return;
  const request = ++hadithDetailsRequest,
    button = document.getElementById('btn-refresh-hadith-details'),
    status = document.getElementById('hadith-details-status');
  button.disabled = true;
  status.textContent = 'جارٍ التحقق من التخريج والبحث عن شرح موثّق…';
  try {
    const updated = await window.mihrabApi.getHadithDetails(key, force);
    if (
      request !== hadithDetailsRequest ||
      (state.hadithState?.hadith?.fingerprint || state.hadithState?.hadith?.id) !== key
    )
      return;
    renderHadithState(updated, { skipDetails: true });
  } catch (error) {
    if (request === hadithDetailsRequest)
      status.textContent = 'تعذر تحديث بيانات الحديث: ' + error.message;
  } finally {
    if (request === hadithDetailsRequest) button.disabled = false;
  }
}

function renderHadithState(hadithState, { skipDetails = false } = {}) {
  if (!hadithState) return;
  const previous = state.hadithState;
  state.hadithState = hadithState;
  renderHadithSharh(
    hadithState.hadith?.sharh,
    previous?.hadith?.fingerprint !== hadithState.hadith?.fingerprint,
  );
  const warning = document.getElementById('hadith-sharh-warning');
  warning.hidden = !hadithState.sharhWarning;
  warning.textContent = hadithState.sharhWarning || '';
  for (const button of document.querySelectorAll('.hadith-library-card'))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.hadithKey === hadithState.hadith?.fingerprint),
    );
  if (
    document.getElementById('tab-hadith').classList.contains('active') &&
    (!hadithLibraryLoaded || previous?.totalStored !== hadithState.totalStored)
  )
    loadHadithLibrary(0);
  const h = hadithState.hadith;
  if (h) {
    document.getElementById('hero-hadith-preview').textContent = h.text;
    document.getElementById('hero-hadith-grade').textContent =
      `${h.grade || 'غير مسجلة'} — ${h.mohdith || ''}`;

    document.getElementById('main-hadith-text').textContent = h.text;
    const missing = (value) => !value || /^(?:-|غير مسجل[ة]?)$/.test(String(value).trim());
    for (const [field, id] of [
      ['rawi', 'main-hadith-rawi'],
      ['mohdith', 'main-hadith-mohdith'],
      ['book', 'main-hadith-book'],
      ['grade', 'main-hadith-grade'],
    ])
      document.getElementById(id).textContent = missing(h[field])
        ? 'غير مذكور في المصدر'
        : h[field];
    document.getElementById('main-hadith-page').textContent = h.pageNumber
      ? 'الصفحة أو الرقم: ' + h.pageNumber
      : '';
    document.querySelector('.hadith-grade-detail').dataset.verdict = missing(h.grade)
      ? 'unknown'
      : /ضعيف|موضوع|منكر|لا يصح|باطل/.test(h.grade)
        ? 'weak'
        : 'recorded';
    document.getElementById('hadith-details-status').textContent =
      hadithState.detailsError || (!h.sharh ? 'لا يتوفر شرح موثّق لهذا الحديث حالياً.' : '');
    document.getElementById('main-hadith-fingerprint').textContent =
      `البصمة: #${(h.fingerprint || '').slice(0, 10)}`;
  }

  if (hadithState.totalStored != null) {
    document.getElementById('stat-hadith-total').textContent = hadithState.totalStored;
  }
  if (hadithState.shownCount != null) {
    document.getElementById('stat-hadith-shown').textContent = hadithState.shownCount;
  }
  if (hadithState.remainingCount != null) {
    document.getElementById('stat-hadith-remaining').textContent = hadithState.remainingCount;
  }
  const key = h?.fingerprint || h?.id;
  if (!skipDetails && key && hadithDetailsKey !== key) {
    hadithDetailsKey = key;
    loadHadithDetails(false);
  }
}

// ============================================================================
// 4. YouTube recommendations, channel filters and interleaving.
// ============================================================================

// Local SVG fallback when a video thumbnail cannot load.
const DEFAULT_LESSON_THUMB_SVG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="100%" height="100%">
  <defs>
    <linearGradient id="thumbBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0e231a"/>
      <stop offset="100%" stop-color="#06120d"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#thumbBg)"/>
  <circle cx="320" cy="165" r="46" fill="#c9a850" opacity="0.2"/>
  <polygon points="310,147 342,165 310,183" fill="#c9a850"/>
  <text x="320" y="244" text-anchor="middle" fill="#8fbf9f" font-family="'IBM Plex Sans Arabic', sans-serif" font-size="20" font-weight="700">محراب — درس مرئي</text>
</svg>
`);

/** Round-robin channel interleaving prevents one channel from dominating the result. */
function interleaveVideosByChannel(videos) {
  if (!Array.isArray(videos) || videos.length <= 1) return videos || [];

  const channelMap = new Map();
  for (const v of videos) {
    const key = v.channelId || v.channelName || 'general';
    if (!channelMap.has(key)) {
      channelMap.set(key, []);
    }
    channelMap.get(key).push(v);
  }

  const interleaved = [];
  const queues = Array.from(channelMap.values());
  let hasMore = true;
  let idx = 0;

  while (hasMore) {
    hasMore = false;
    for (const queue of queues) {
      if (idx < queue.length) {
        interleaved.push(queue[idx]);
        hasMore = true;
      }
    }
    idx++;
  }

  return interleaved;
}

/** Fisher-Yates shuffle. */
function fisherYatesShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Shuffle within recent time windows to vary channels while preserving freshness. */
function shufflePreservingFreshness(videos, windowSize = 8) {
  if (!Array.isArray(videos) || videos.length <= 2) return videos || [];
  const shuffled = [];
  for (let i = 0; i < videos.length; i += windowSize) {
    const windowChunk = videos.slice(i, i + windowSize);
    shuffled.push(...fisherYatesShuffle(windowChunk));
  }
  return shuffled;
}

function escapeYoutubeText(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

let lessonFeed = null;
let lessonSource = null;
let lessonFilterKey = null;

function createLessonCard(v) {
  if (
    !/^[a-zA-Z0-9_-]{11}$/.test(v.videoId) ||
    !/^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}(?:&|$)/.test(v.url)
  ) {
    throw new Error('بيانات أحد الدروس لا تحتوي رابط فيديو صالحاً.');
  }
  const card = document.createElement('div');
  card.className = 'lesson-card';
  card.dataset.videoId = v.videoId;
  card.classList.toggle('recommended-lesson', v.videoId === state.recommendedVideoId);
  const thumbUrl =
    v.thumbnailUrl || `https://img.youtube.com/vi/${escapeYoutubeText(v.videoId)}/mqdefault.jpg`;
  card.innerHTML = `
      <div class="lesson-thumbnail-wrap">
        ${
          window.mihrabPerformance.profile.images
            ? `<img class="lesson-thumbnail" 
             ${state.config?.network?.enabled === false || state.config?.network?.categories?.youtube === false ? '' : 'src="' + escapeYoutubeText(thumbUrl) + '"'} 
             alt="${escapeYoutubeText(v.title)}" 
             loading="lazy" decoding="async" width="640" height="360" fetchpriority="low" 
             data-vid="${escapeYoutubeText(v.videoId)}"  />`
            : ''
        }
        <span class="lesson-badge-overlay">🎯 ${escapeYoutubeText(v.contextTitle || 'علم وتزكية')}</span>
      </div>
      <div class="lesson-content">
        <h4 class="lesson-title" title="${escapeYoutubeText(v.title)}">
          ${escapeYoutubeText(v.title)}
        </h4>
        <div class="lesson-meta">
          <span>🎙️ ${escapeYoutubeText(v.channelName)}</span>
          <span>⏱️ ${escapeYoutubeText(v.durationEstimate || 'درس كامل')}</span>
        </div>
        <button data-watch-url="${escapeYoutubeText(v.url)}" class="btn btn-primary" style="width: 100%; margin-top: var(--spacing-xs);" title="${escapeYoutubeText(v.url)}">
          مشاهدة الدرس ↗
        </button>
      </div>
    `;

  const image = card.querySelector('img');
  let attempts = 0;
  if (image)
    image.addEventListener('error', function fallback() {
      if (attempts++ === 0) image.src = `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`;
      else {
        image.removeEventListener('error', fallback);
        image.dataset.thumbnailState = 'fallback';
        image.src = DEFAULT_LESSON_THUMB_SVG;
      }
    });
  return card;
}

function emptyLessonState() {
  const message = document.createElement('div');
  message.className = 'lesson-empty-state';
  message.textContent = 'لا توجد دروس مطابقة. غيّر خيارات التصفية أو حدّث الخلاصات.';
  return message;
}

function getLessonFeed() {
  if (lessonFeed) return lessonFeed;
  const grid = document.getElementById('yt-videos-grid');
  const progress = document.getElementById('yt-feed-progress');
  const Feed = window.mihrabPerformance.profile.paged
    ? window.MihrabPagedLessonFeed
    : window.MihrabLessonFeed;
  lessonFeed = new Feed({
    grid,
    root: document.getElementById('yt-lessons-scroll'),
    createCard: createLessonCard,
    emptyState: emptyLessonState,
    onCount: (shown, total) => {
      if (lessonFeed?.isPaged) {
        progress.textContent = total
          ? `الدروس ${lessonFeed.offset + 1}–${lessonFeed.offset + shown} من ${total} — مرّر أو استخدم السابق والتالي.`
          : 'لا توجد دروس مطابقة.';
        return;
      }
      progress.textContent = !total
        ? ''
        : shown === total
          ? `تم عرض جميع الدروس (${total}).`
          : `عرض ${shown} من ${total} درساً — مرّر لتحميل المزيد.`;
    },
    onError: (error) => {
      progress.textContent = `تعذر عرض الدروس: ${error.message}`;
      showOperationResultModal({
        success: false,
        title: 'تعذر عرض الدروس',
        summary: error.message,
        details: error.stack,
      });
    },
  });
  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-watch-url]');
    if (!button || !grid.contains(button)) return;
    try {
      const result = await window.mihrabApi.openExternalUrl(button.dataset.watchUrl);
      if (result?.opened === false) throw new Error('تعذر فتح رابط الدرس.');
    } catch (error) {
      showOperationResultModal({ success: false, title: 'تعذر فتح الدرس', summary: error.message });
    }
  });
  return lessonFeed;
}

function renderFilteredLessons() {
  if (window.mihrabPerformance.profile.paged) {
    const feed = getLessonFeed();
    feed.setFilter({
      channelIds: [...state.selectedChannelIds],
      contextIds: [...state.selectedContextIds],
      recommendedVideoId: state.recommendedVideoId,
    });
    feed.setActive(document.getElementById('tab-youtube').classList.contains('active'));
    return;
  }

  const videos = Array.isArray(state.youtubeState?.videos) ? state.youtubeState.videos : [];
  const key = JSON.stringify([
    [...state.selectedChannelIds].sort(),
    [...state.selectedContextIds].sort(),
    state.recommendedVideoId,
  ]);
  const feed = getLessonFeed();
  const active = document.getElementById('tab-youtube').classList.contains('active');
  if (videos !== lessonSource || key !== lessonFilterKey) {
    const filtered = videos.filter(
      (video) =>
        (!state.selectedChannelIds.size || state.selectedChannelIds.has(video.channelId)) &&
        (!state.selectedContextIds.size || state.selectedContextIds.has(video.contextId)),
    );
    feed.setActive(false);
    const ordered = shufflePreservingFreshness(interleaveVideosByChannel(filtered), 8);
    if (state.recommendedVideoId) {
      const index = ordered.findIndex((video) => video.videoId === state.recommendedVideoId);
      if (index > 0) ordered.unshift(...ordered.splice(index, 1));
    }
    feed.setItems(ordered);
    lessonSource = videos;
    lessonFilterKey = key;
  }
  feed.setActive(active);
}

function reportYoutubeRefreshError(...errors) {
  const codes = [...new Set(errors.map(error => {
    const explicit = Number(error?.status);
    return explicit >= 400 && explicit <= 599 ? explicit : /HTTP\s+([45]\d{2})/.exec(error?.error || error?.message || '')?.[1];
  }).filter(Boolean).map(String))];
  showOperationResultModal({
    success: false,
    title: 'حصل خطأ',
    summary: codes.length ? codes.join('، ') : 'تعذر تحديث الخلاصات.',
  });
}

function ensureYoutubeRefresh() {
  if (
    window.mihrabPerformance.profile.id === 'eco' ||
    !state.youtubeState ||
    state.youtubeRefreshStarted ||
    state.config?.network?.enabled === false ||
    state.config?.network?.categories?.youtube === false
  )
    return;
  state.youtubeRefreshStarted = true;
  refreshYoutubeData().catch(error => console.warn('Background lesson refresh:', error.message));
}

async function refreshYoutubeData() {
  if (state.youtubeRefreshPromise) return state.youtubeRefreshPromise;
  const button = document.getElementById('btn-refresh-yt');
  button.disabled = true;
  button.classList.add('is-refreshing');
  state.youtubeRefreshPromise = window.mihrabApi
    .refreshYoutubeFeeds('all')
    .then((feeds) => {
      renderYoutubeState(feeds);
      return feeds;
    })
    .finally(() => {
      state.youtubeRefreshPromise = null;
      button.disabled = false;
      button.classList.remove('is-refreshing');
    });
  return state.youtubeRefreshPromise;
}

function renderYoutubeState(ytState) {
  if (!ytState) return;
  state.youtubeState = ytState;
  const followed = new Set((ytState.channels || []).map(channel => channel.channelId));
  for (const id of state.selectedChannelIds) if (!followed.has(id)) state.selectedChannelIds.delete(id);
  const contextCounts = lessonContextCounts(ytState, state.selectedChannelIds);
  for (const id of state.selectedContextIds) if (!contextCounts.get(id)) state.selectedContextIds.delete(id);

  // 1. Populate the channel picker without already selected channels.
  const channelPicker = document.getElementById('yt-channel-picker');
  if (channelPicker && Array.isArray(ytState.channels)) {
    channelPicker.innerHTML = '<option value="">الشيوخ والقنوات</option>';
    for (const ch of ytState.channels) {
      if (!state.selectedChannelIds.has(ch.channelId)) {
        channelPicker.appendChild(new Option(ch.name, ch.channelId));
      }
    }
  }

  // 2. Render removable tags for selected channels.
  const channelTagsContainer = document.getElementById('yt-channel-tags-container');
  if (channelTagsContainer && Array.isArray(ytState.channels)) {
    channelTagsContainer.innerHTML = '';

    const allChannelsChip = document.createElement('span');
    allChannelsChip.className = `filter-chip chip-default ${state.selectedChannelIds.size === 0 ? 'active' : ''}`;
    allChannelsChip.textContent = 'كافة القنوات (الكل)';
    allChannelsChip.title = 'إلغاء التصفية الخاصة بالقنوات وعرض كافة المشايخ';
    allChannelsChip.addEventListener('click', () => {
      if (state.selectedChannelIds.size > 0) {
        state.selectedChannelIds.clear();
        renderYoutubeState(state.youtubeState);
      }
    });
    channelTagsContainer.appendChild(allChannelsChip);

    for (const chId of state.selectedChannelIds) {
      const ch = ytState.channels.find((c) => c.channelId === chId) || { name: chId };
      const chip = document.createElement('span');
      chip.className = 'filter-chip active';
      chip.innerHTML = `
        <span class="channel-chip-label" title="${escapeYoutubeText(ch.name)}">${escapeYoutubeText(ch.name)}</span>
        <button class="chip-remove" title="إلغاء التحديد">&times;</button>
      `;
      chip.querySelector('.chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedChannelIds.delete(chId);
        renderYoutubeState(state.youtubeState);
      });
      channelTagsContainer.appendChild(chip);
    }
  }

  // 3. Populate the topic picker without already selected topics.
  const contextPicker = document.getElementById('yt-context-picker');
  if (contextPicker && Array.isArray(ytState.contexts)) {
    contextPicker.innerHTML = '<option value="">السياقات</option>';
    for (const ctx of ytState.contexts) {
      if (!state.selectedContextIds.has(ctx.id)) {
        const count = contextCounts.get(ctx.id) || 0;
        const option = new Option(count ? `${ctx.title} (${count})` : ctx.title, ctx.id);
        option.disabled = count === 0;
        contextPicker.appendChild(option);
      }
    }
  }

  // 4. Render removable tags for selected topics.
  const contextTagsContainer = document.getElementById('yt-context-tags-container');
  if (contextTagsContainer && Array.isArray(ytState.contexts)) {
    contextTagsContainer.innerHTML = '';

    const allContextsChip = document.createElement('span');
    allContextsChip.className = `filter-chip chip-default ${state.selectedContextIds.size === 0 ? 'active' : ''}`;
    allContextsChip.textContent = 'كافة السياقات (الكل)';
    allContextsChip.title = 'إلغاء التصفية الخاصة بالسياقات وعرض كافة الموضوعات';
    allContextsChip.addEventListener('click', () => {
      if (state.selectedContextIds.size > 0) {
        state.selectedContextIds.clear();
        renderYoutubeState(state.youtubeState);
      }
    });
    contextTagsContainer.appendChild(allContextsChip);

    for (const ctxId of state.selectedContextIds) {
      const ctx = ytState.contexts.find((c) => c.id === ctxId) || { title: ctxId };
      const chip = document.createElement('span');
      chip.className = 'filter-chip active';
      chip.innerHTML = `
        <span>🎯 ${escapeYoutubeText(ctx.title)}</span>
        <button class="chip-remove" title="إلغاء التحديد">&times;</button>
      `;
      chip.querySelector('.chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedContextIds.delete(ctxId);
        renderYoutubeState(state.youtubeState);
      });
      contextTagsContainer.appendChild(chip);
    }
  }

  // 5. Render subscribed channels.
  const channelsContainer = document.getElementById('yt-channels-list');
  if (channelsContainer && Array.isArray(ytState.channels)) {
    channelMarquee?.release();
    for (const row of channelsContainer.children) channelAvatarObserver.unobserve(row);
    channelsContainer.innerHTML = '';
    for (const ch of ytState.channels) {
      const row = document.createElement('div');
      row.className = 'channel-row';
      row.innerHTML = `<div class="channel-head"><span class="channel-avatar" aria-hidden="true"></span><strong class="channel-name">${escapeYoutubeText(ch.name)}</strong></div><button class="btn btn-danger" aria-label="حذف ${escapeYoutubeText(ch.name)}">حذف</button>`;
      if (window.mihrabApi.getChannelAvatar) observeChannelAvatar(row, ch.channelId);
      row.querySelector('button').addEventListener('click', () => {
        openDeleteChannelModal(ch);
      });
      channelsContainer.appendChild(row);
    }
  }

  channelMarquee?.schedule();
  // 6. Apply channel and topic filters together.
  renderFilteredLessons();
}

function openDeleteChannelModal(channel) {
  state.pendingDeleteChannel = channel;
  document.getElementById('delete-modal-channel-name').textContent = channel.name;
  document.getElementById('delete-modal-channel-id').textContent = channel.channelId;
  document.getElementById('modal-delete-channel').classList.add('open');
}

// ============================================================================
// 5. Quran portions, dynamic ranges and random reading mode.
// ============================================================================

/** Rebuild end positions so the selected end cannot precede the start. */
let quranSaveQueue = Promise.resolve();
function activateQuranMode(mode, focus = false) {
  state.quranMode = mode === 'hifz' ? 'hifz' : 'reading';
  updateQuranSettingsSection();
  document.querySelectorAll('[data-quran-mode]').forEach((button) => {
    const active = button.dataset.quranMode === state.quranMode;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById('quran-panel-' + button.dataset.quranMode).hidden = !active;
    if (active && focus) button.focus();
  });
}
let quranTransitionBusy = false;
async function showQuranPageTurn(kind, updated, { random = false } = {}) {
  const host = document.getElementById(kind + '-boundaries');
  const previous = state.quranState?.[kind + 'Summary'],
    next = updated?.[kind + 'Summary'];
  const delta = (next?.startNumber || 0) - (previous?.startNumber || 0),
    forward = delta < 0;
  // Increasing positions turn left to right; decreasing positions mirror that motion.
  const front = host
    .querySelector(forward ? '.book-start-page' : '.book-end-page')
    ?.cloneNode(true);
  const stationary = host
    .querySelector(forward ? '.book-end-page' : '.book-start-page')
    ?.cloneNode(true);
  const oldHeight = host.offsetHeight;
  renderQuranState(updated);
  host.dataset.turnDirection = forward ? 'forward' : 'backward';
  const distance = Math.abs(delta),
    count = random && distance > 1 ? (distance >= 12 ? 4 : 3) : 1;
  host.dataset.turnPages = String(count);
  if (
    !delta ||
    !front ||
    !stationary ||
    accessibilityState.reduceMotion ||
    !window.mihrabPerformance.profile.animations ||
    matchMedia('(prefers-reduced-motion: reduce), (max-width:680px)').matches ||
    !host.getClientRects().length ||
    typeof host.animate !== 'function'
  )
    return;
  const back = host.querySelector(forward ? '.book-end-page' : '.book-start-page')?.cloneNode(true);
  const layers = [],
    animations = [],
    sign = forward ? -1 : 1;
  // Keep old/new faces at one height while rotating, even if their text wraps differently.
  const savedMinHeight = host.style.minHeight,
    savedPerspective = host.style.perspective;
  const turnHeight = Math.max(oldHeight, host.offsetHeight);
  host.style.minHeight = turnHeight + 'px';
  // Reserve at most 28px of projected rise, including tall verses at narrow widths.
  host.style.perspective =
    Math.ceil(Math.max(3200, (host.clientWidth / 2 + 4) * (1 + turnHeight / 56))) + 'px';
  const ghost = document.createElement('div');
  ghost.className = 'flip-previous-underlay ' + (forward ? 'forward' : 'backward');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.append(stationary);
  host.append(ghost);
  layers.push(ghost);
  host.classList.add('is-flipping');
  try {
    for (let i = 0; i < count; i++) {
      const sheet = document.createElement('div');
      sheet.className = 'flipping-sheet ' + (forward ? 'forward' : 'backward');
      sheet.setAttribute('aria-hidden', 'true');
      const timing = {
        duration: count > 1 ? 680 : 840,
        delay: i * 110,
        easing: 'cubic-bezier(.32,.12,.24,1)',
        fill: 'both',
      };
      for (const [side, page] of [
        ['front', front],
        ['back', back],
      ]) {
        const face = document.createElement('div');
        face.className = 'sheet-face sheet-' + side;
        const snapshot = page.cloneNode(true);
        // Intermediate leaves convey distance without duplicating Quran verses in mid-air.
        if ((side === 'front' && i > 0) || (side === 'back' && i < count - 1))
          snapshot.classList.add('riffle-blank');
        face.append(snapshot);
        const light = document.createElement('span');
        light.className = 'sheet-lighting';
        face.append(light);
        sheet.append(face);
        animations.push(
          light.animate(
            [
              { opacity: 0 },
              { opacity: side === 'front' ? 0.4 : 0.3, offset: 0.5 },
              { opacity: 0 },
            ],
            timing,
          ),
        );
      }
      host.append(sheet);
      layers.push(sheet);
      // The source stack descends; the receiving stack builds in the opposite order.
      animations.push(
        sheet.animate(
          [
            { transform: 'translateZ(' + (1 + (count - i) * 0.45) + 'px) rotateY(0deg)' },
            { transform: 'translateZ(2px) rotateY(' + sign * 90 + 'deg)', offset: 0.5 },
            {
              transform:
                'translateZ(' + (1 + (i + 1) * 0.45) + 'px) rotateY(' + sign * 180 + 'deg)',
            },
          ],
          timing,
        ),
      );
    }
    await Promise.all(
      animations.map((animation) =>
        animation.finished.catch((error) => {
          if (error.name !== 'AbortError') throw error;
        }),
      ),
    );
  } finally {
    for (const animation of animations) animation.cancel();
    for (const layer of layers) layer.remove();
    host.classList.remove('is-flipping');
    host.style.minHeight = savedMinHeight;
    host.style.perspective = savedPerspective;
  }
}

async function completeQuranWithTurn(kind, random = false) {
  if (quranTransitionBusy) return;
  quranTransitionBusy = true;
  const buttons = ['btn-complete-reading', 'btn-complete-hifz', 'btn-roll-random-reading'].map(
    (id) => document.getElementById(id),
  );
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (!(await autoSaveQuranSettings())) return;
    const updated = random
      ? await window.mihrabApi.rollRandomQuranReading()
      : await window.mihrabApi.advanceQuranProgress(kind);
    await showQuranPageTurn(kind, updated, { random });
  } catch (error) {
    showOperationResultModal({ success: false, title: 'تعذر تحديث الورد', summary: error.message });
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    quranTransitionBusy = false;
  }
}

function bindWirdPositionEditors() {
  for (const kind of ['reading', 'hifz']) {
    const form = document.getElementById(kind + '-current-assignment');
    const input = document.getElementById(kind + '-position-input');
    const surah = document.getElementById(kind + '-position-surah');
    let busy = false;
    const save = async () => {
      if (busy) return;
      busy = true;
      const entered = surah.disabled ? input.valueAsNumber : Number(surah.value);
      try {
        await quranSaveQueue;
        const summary = state.quranState?.[kind + 'Summary'];
        if (!summary) return;
        if (!Number.isInteger(entered)) {
          throw Error('أدخل رقمًا صحيحًا بين ' + summary.progress.min + ' و' + summary.progress.max + '.');
        }
        const value = entered;
        if (value === summary.startNumber) {
          input.value = value;
          return;
        }
        const result = await window.mihrabApi.setQuranPosition(kind, value);
        renderQuranState(result.quranState);
        if (result.message) showSuccessFeedback(result.message);
      } catch (error) {
        const current = state.quranState?.[kind + 'Summary']?.startNumber ?? '';
        input.value = current;
        surah.value = current;
        showSuccessFeedback(error.message);
      } finally {
        busy = false;
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    input.addEventListener('change', save);
    surah.addEventListener('change', save);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      input.value = state.quranState?.[kind + 'Summary']?.startNumber ?? '';
      input.blur();
    });
  }
  window.addEventListener('mihrab:quran-state', event => renderQuranState(event.detail));
}

function renderQuranSummaries(data) {
  // Validate both sides of every incoming summary before changing any visible content.
  const prepared = [];
  for (const kind of ['reading', 'hifz']) {
    const summary = data?.[kind + 'Summary'];
    if (!summary) continue;
    const points = ['start', 'end'].map((side) => {
      const point = summary.boundaries?.[side];
      if (
        !point ||
        typeof point.text !== 'string' ||
        !point.text.trim() ||
        typeof point.surahName !== 'string' ||
        !point.surahName.trim() ||
        !Number.isInteger(Number(point.ayah)) ||
        Number(point.ayah) < 1
      )
        throw Error(
          'بيانات ' +
            (side === 'start' ? 'بداية' : 'نهاية') +
            ' الورد غير مكتملة؛ أُبقي العرض السابق.',
        );
      const words = point.text.trim().split(/\s+/);
      return {
        side,
        title: (side === 'start' ? 'من: ' : 'إلى: ') + point.surahName + ' — الآية ' + point.ayah,
        text:
          words.length > 14
            ? side === 'start'
              ? words.slice(0, 14).join(' ') + ' …'
              : '… ' + words.slice(-14).join(' ')
            : point.text,
        fullText: point.text,
      };
    });
    prepared.push({ kind, summary, points });
  }
  const card = document.getElementById('quran-unified-card');
  card.dataset.riwaya = data.riwaya || 'hafs';
  document.getElementById('quran-riwaya-badge').textContent = data.riwayaTitle || '';
  for (const { kind, summary, points } of prepared) {
    const host = document.getElementById(kind + '-boundaries');
    // Keep the two fixed page nodes in place; update their text synchronously.
    // Animation sheets are independent snapshots and are never cleared here.
    for (const point of points) {
      const className = point.side === 'start' ? 'book-start-page' : 'book-end-page';
      let section = Array.from(host.children).find((node) => node.classList.contains(className));
      if (!section) {
        section = document.createElement('section');
        section.className = 'quran-boundary ' + className;
        if (point.side === 'start') host.prepend(section);
        else host.append(section);
      }
      let label = section.querySelector('h4'),
        quote = section.querySelector('p');
      if (!label) {
        label = document.createElement('h4');
        section.append(label);
      }
      if (!quote) {
        quote = document.createElement('p');
        section.append(quote);
      }
      label.textContent = point.title;
      quote.textContent = point.text;
      quote.title = point.fullText;
    }
    if (!host.querySelector(':scope > .book-spine-divider')) {
      const spine = document.createElement('span');
      spine.className = 'book-spine-divider';
      spine.setAttribute('aria-hidden', 'true');
      host.append(spine);
    }
    // Ornaments belong to their paper surface, so cloned leaves carry them too.
    for (const node of host.querySelectorAll(':scope > .book-corner')) node.remove();
    for (const [page, corners] of [
      [host.querySelector(':scope > .book-start-page'), ['tr', 'br']],
      [host.querySelector(':scope > .book-end-page'), ['tl', 'bl']],
    ]) {
      for (const corner of corners)
        if (!page.querySelector('.book-corner-' + corner)) {
          const ornament = document.createElement('span');
          ornament.className = 'book-corner book-corner-' + corner;
          ornament.setAttribute('aria-hidden', 'true');
          page.append(ornament);
        }
    }
    const input = document.getElementById(kind + '-position-input');
    const unit = summary.unitLabel;
    const end = document.getElementById(kind + '-position-end');
    const label = document.getElementById(kind + '-position-label');
    const surah = document.getElementById(kind + '-position-surah');
    const bySurah = summary.unit === 'surah';
    label.htmlFor = bySurah ? surah.id : input.id;
    label.textContent = bySurah ? (summary.amount > 1 ? 'من سورة' : 'سورة')
      : (summary.amount > 1 ? 'من ' + unit : unit + ' رقم');
    surah.closest('.wird-surah-picker').hidden = !bySurah;
    surah.disabled = !bySurah;
    input.hidden = bySurah;
    if (bySurah) {
      const options = data.surahs
        .filter(row => row.number >= summary.progress.min && row.number <= summary.maxStart)
        .map(row => new Option(row.name, row.number));
      if (summary.startNumber > summary.maxStart) {
        const current = new Option(data.surahs[summary.startNumber - 1].name, summary.startNumber);
        current.disabled = true;
        options.push(current);
      }
      surah.replaceChildren(...options);
      surah.value = summary.startNumber;
      surah.closest('.wird-surah-picker').dataset.surahName = surah.selectedOptions[0]?.textContent || '';
    }
    input.min = summary.progress.min;
    input.max = summary.progress.max;
    input.value = summary.startNumber;
    input.disabled = bySurah;
    input.title = summary.currentAssignment;
    end.hidden = summary.amount <= 1;
    const endName = bySurah ? data.surahs[summary.endNumber - 1].name : summary.endNumber;
    end.textContent = 'إلى ' + unit + ' ' + endName;
    const marker = document.getElementById(kind + '-progress-mark');
    marker.hidden = !summary.bookmark;
    if (summary.bookmark) {
      const title = 'الموضع المحفوظ: ' + summary.bookmark.surahName + '، الآية ' + summary.bookmark.ayah;
      marker.style.setProperty('--wird-mark', summary.progress.bookmarkPercentage + '%');
      marker.setAttribute('aria-label', title);
      marker.dataset.label = title;
      marker.toggleAttribute('data-near-start', summary.progress.bookmarkPercentage < 40);
    }
    document.getElementById(kind + '-range-desc').textContent = summary.rangeDescription;
    const track = document.getElementById(kind + '-progress');
    track.style.setProperty('--wird-range-start', summary.progress.startPercentage + '%');
    track.style.setProperty('--wird-range-end', summary.progress.endPercentage + '%');
    document.getElementById(kind + '-progress-label').textContent =
      'موضع الورد: ' + summary.startNumber +
      (summary.endNumber === summary.startNumber ? '' : '–' + summary.endNumber) +
      ' من ' + summary.progress.max;
    document.getElementById(kind + '-schedule-badge').textContent =
      data.schedules?.[kind + 'TimingDescription'] || '';
  }
}
function updateQuranTiming(kind) {
  const mode = document.getElementById('quran-notif-mode').value,
    enabled = mode === 'both' || mode === kind + '_only';
  const fixed = document.getElementById(kind + '-custom-enabled').checked;
  document.getElementById(kind + '-prayer-enabled').checked = !fixed;
  const panel = document.getElementById('notice-' + kind);
  panel.classList.toggle('is-inactive', !enabled);
  panel.hidden = !enabled;
  for (const input of panel.querySelectorAll('input,select')) input.disabled = !enabled;
  for (const timing of ['prayer', 'fixed']) {
    const box = document.getElementById(kind + '-' + timing + '-fields'),
      inactive = (timing === 'fixed') !== fixed;
    box.disabled = !enabled || inactive;
    box.hidden = inactive;
    box.classList.toggle('is-inactive', inactive);
    box.setAttribute('aria-disabled', String(!enabled || inactive));
  }
}

/** Switch reading reminders between fixed and prayer-relative timing. */
function updateReadingTimeToggle() {
  updateQuranTiming('reading');
}

/** Switch memorization reminders between fixed and prayer-relative timing. */
function updateHifzTimeToggle() {
  updateQuranTiming('hifz');
}

function wirdAmountLimit(kind, unit, status = state.quranState) {
  const current = status?.[kind + 'Summary'];
  if (current?.unit === unit) return current.progress.max - current.progress.min + 1;
  return { juz: 30, hizb: 60, rub: 240, surah: 114, page: status?.totalPages || 604 }[unit];
}

/** Queue Quran setting saves when fields change. */
async function autoSaveQuranSettings() {
  const amounts = {};
  for (const kind of ['reading', 'hifz']) {
    const field = document.getElementById(kind + '-amount');
    const unit = document.getElementById(kind + '-unit').value;
    const limit = wirdAmountLimit(kind, unit);
    field.max = limit;
    const amount = field.valueAsNumber;
    if (!Number.isInteger(amount) || amount < 1) {
      field.value = state.quranState?.[kind + 'Summary']?.amount ?? 1;
      showSuccessFeedback('أدخل مقدارًا صحيحًا بين 1 و' + limit + '.');
      return false;
    }
    amounts[kind] = Math.min(amount, limit);
    if (amount > limit) {
      field.value = limit;
      showSuccessFeedback('الحد الأعلى لمقدار الورد في النطاق المختار هو ' + limit + '.');
    }
  }
  const readingUnit = document.getElementById('reading-unit')?.value || 'hizb';
  const readingMode = document.getElementById('reading-mode')?.value || 'sequential';

  const updatedQuranWird = {
    riwaya: document.getElementById('quran-riwaya').value,
    reading: { mode: readingMode, unit: readingUnit, amount: amounts.reading },
    hifz: {
      unit: document.getElementById('hifz-unit').value,
      amount: amounts.hifz,
    },
  };

  const job = quranSaveQueue.then(async () => {
    try {
      await window.migrateQuranBookmarks?.(state.quranState);
      const res = await window.mihrabApi.saveSettings({ quranWird: updatedQuranWird });
      if (!res?.quranState) throw new Error('لم تصل حالة الورد بعد الحفظ.');
      state.config = res.config;
      renderQuranState(res.quranState);
      return res;
    } catch (error) {
      showSuccessFeedback(error.message || 'تعذر حفظ إعدادات القرآن.');
      return false;
    }
  });
  quranSaveQueue = job.then(() => {});
  return await job;
}

function renderQuranState(quranState) {
  if (!quranState) return;
  renderQuranSummaries(quranState);
  state.quranState = quranState;
  window.migrateQuranBookmarks?.(quranState).catch(() => {});
  renderQuranNotificationShortcuts();
  const qw = quranState.settings;
  document.getElementById('quran-riwaya').value = qw.riwaya || 'hafs';
  if (qw) {
    document.getElementById('quran-notif-mode').value = qw.notificationMode || 'both';

    document.getElementById('reading-after-prayer').value = qw.reading?.afterPrayer || 'isha';
    document.getElementById('hifz-after-prayer').value = qw.hifz?.afterPrayer || 'fajr';
    // Reading plan.
    const rMode = qw.reading?.mode || 'sequential';
    document.getElementById('reading-mode').value = rMode;
    if (
      qw.reading?.unit === 'page' &&
      !document.getElementById('reading-unit').querySelector('[value=page]')
    )
      document.getElementById('reading-unit').add(new Option('صفحة (إعداد سابق)', 'page'));
    document.getElementById('reading-unit').value = qw.reading?.unit || 'juz';
    const readingAmount = document.getElementById('reading-amount');
    readingAmount.max = wirdAmountLimit('reading', qw.reading?.unit || 'juz', quranState);
    readingAmount.value = quranState.readingSummary?.amount || 1;
    document.getElementById('reading-after-isha').value =
      qw.reading?.afterPrayerMinutes ?? qw.reading?.afterIshaMinutes ?? 30;
    document.getElementById('reading-custom-enabled').checked = Boolean(
      qw.reading?.customTimeEnabled,
    );
    document.getElementById('reading-custom-time').value = qw.reading?.customTime || '20:30';

    const isRandom = rMode === 'random';
    document.getElementById('btn-complete-reading').style.display = isRandom
      ? 'none'
      : 'inline-flex';
    document.getElementById('btn-roll-random-reading').style.display = isRandom
      ? 'inline-flex'
      : 'none';

    // Memorization and revision plan.
    const hUnit = qw.hifz?.unit || 'juz';
    for (const kind of ['reading', 'hifz'])
      if (
        qw[kind]?.unit === 'page' &&
        !document.getElementById(kind + '-unit').querySelector('[value=page]')
      )
        document.getElementById(kind + '-unit').add(new Option('صفحة (إعداد سابق)', 'page'));
    document.getElementById('hifz-unit').value = hUnit;
    const hifzAmount = document.getElementById('hifz-amount');
    hifzAmount.max = wirdAmountLimit('hifz', hUnit, quranState);
    hifzAmount.value = quranState.hifzSummary?.amount || 1;
    document.getElementById('hifz-after-fajr').value =
      qw.hifz?.afterPrayerMinutes ?? qw.hifz?.afterFajrMinutes ?? 30;
    document.getElementById('hifz-custom-enabled').checked = Boolean(qw.hifz?.customTimeEnabled);
    document.getElementById('hifz-custom-time').value = qw.hifz?.customTime || '05:45';

    // Enable only the selected fixed or relative timing fields.
    updateReadingTimeToggle();
    updateHifzTimeToggle();
  }

  if (quranState.schedules) {
    document.getElementById('reading-schedule-badge').textContent =
      quranState.schedules.readingTimingDescription;
    document.getElementById('hifz-schedule-badge').textContent =
      quranState.schedules.hifzTimingDescription;
  }
}

// ============================================================================
// 6. Settings and cascading location selectors.
// ============================================================================
const OFFLINE_PRAYER_MESSAGE = 'قد يكون التوقيت غير دقيق لعدم توفر اتصال بالإنترنت حالياً';
function renderVerificationStatus(report = state.prayerData?.verification) {
  const box = document.getElementById('official-sync-report-box');
  if (!box) return;
  const network = state.config?.network;
  box.textContent =
    network && (network.enabled === false || network.categories?.prayer === false)
      ? 'التحديث عبر الإنترنت متوقف؛ تُعرض المواقيت بالحساب المحلي وآخر ضبط محفوظ.'
      : navigator.onLine === false
        ? OFFLINE_PRAYER_MESSAGE
        : report?.message || '';
  if (state.prayerData?.calculationWarning)
    box.textContent += ' ' + state.prayerData.calculationWarning;
}
function initializeGeography(countries, cities, config) {
  if (Array.isArray(countries)) state.countries = countries;
  if (!state.countries.length && Array.isArray(cities)) {
    state.countries = [
      ...new Map(
        cities.map((city) => [
          city.country,
          { code: city.countryCode || city.country, name: city.country, method: city.method },
        ]),
      ).values(),
    ];
  }
  if (Array.isArray(cities)) {
    const country = state.countries.find(
      (item) =>
        item.code === config?.location?.countryCode || item.name === config?.location?.country,
    );
    if (country) state.citiesByCountry.set(country.code, cities);
  }
}
function currentCountry(value) {
  return state.countries.find((country) => country.code === value || country.name === value);
}
function populateTimeZones(selected) {
  const field = document.getElementById('settings-time-zone');
  if (!field) return;
  if (!field.options.length) {
    const zones = Intl.supportedValuesOf
      ? Intl.supportedValuesOf('timeZone')
      : [Intl.DateTimeFormat().resolvedOptions().timeZone];
    for (const zone of zones) field.add(new Option(zone.replaceAll('_', ' '), zone));
  }
  if (selected && ![...field.options].some((option) => option.value === selected))
    field.add(new Option(selected, selected));
  field.value = selected || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function setMethodHint(manual = state.methodManuallySelected) {
  const hint = document.getElementById('settings-method-hint');
  if (hint)
    hint.textContent = manual
      ? 'اخترت طريقة الحساب يدوياً. ستبقى عند تغيير المدينة داخل الدولة نفسها.'
      : 'اختيرت الطريقة تلقائياً حسب الدولة. يمكنك تغييرها يدوياً.';
}
function populateCitiesDropdown(countryValue, targetCityName = '', filterQuery = '') {
  const citySelect = document.getElementById('settings-city-select'),
    search = null,
    count = document.getElementById('settings-city-count');
  if (!citySelect) return;
  citySelect.replaceChildren();
  const country = currentCountry(countryValue);
  const all = country ? state.citiesByCountry.get(country.code) || [] : [];
  const fold = (value) =>
    String(value || '')
      .normalize('NFKD')
      .replace(/[\u064b-\u065f\u0670\u0300-\u036f]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .toLowerCase();
  const query = fold(filterQuery.trim());
  const matches = query
    ? all.filter((city) =>
        fold([city.city, city.asciiName, city.nativeName].join(' ')).includes(query),
      )
    : all;
  const shown = matches.slice(0, 200);
  const selected = all.find((city) => city.city === targetCityName);
  if (selected && !shown.includes(selected) && !query) shown.unshift(selected);
  if (!shown.length)
    citySelect.add(
      new Option(country ? 'لا توجد مدينة مطابقة؛ يمكنك إدخالها يدوياً' : 'اختر الدولة أولاً', ''),
    );
  const fragment = document.createDocumentFragment();
  for (const city of shown)
    fragment.appendChild(
      new Option(
        city.city +
          (city.nativeName && city.nativeName !== city.city ? ' — ' + city.nativeName : ''),
        city.id,
      ),
    );
  citySelect.appendChild(fragment);
  citySelect.disabled = !shown.length;
  if (search) search.disabled = !country || !all.length;
  if (selected && shown.includes(selected)) citySelect.value = selected.id;
  if (count)
    count.textContent = !country
      ? ''
      : matches.length > 200
        ? 'عرض أول 200 مدينة من ' + matches.length + '؛ اكتب اسم المدينة لتضييق النتائج.'
        : matches.length +
          ' مدينة متاحة.' +
          (!all.length ? ' أدخل موقعك من الخيارات اليدوية أدناه.' : '');
}
async function loadCountryCities(country) {
  if (!state.citiesByCountry.has(country.code)) {
    if (!window.mihrabApi.getCountryCities)
      throw new Error('تعذر تحميل مدن الدولة؛ أعد تشغيل التطبيق بعد التحديث.');
    state.citiesByCountry.set(country.code, await window.mihrabApi.getCountryCities(country.code));
  }
  return state.citiesByCountry.get(country.code);
}
async function refreshCurrentCountryCities(location) {
  const country = currentCountry(location?.countryCode) || currentCountry(location?.country);
  if (!country) return;
  await loadCountryCities(country);
  if (state.config?.location?.country === location.country)
    populateCitiesDropdown(country.code, location.city);
}

function renderSettingsForm(config, cities) {
  document.getElementById('auto-prayer-verification').checked = config.automation?.verifyPrayerTimes ?? config.officialSync?.enabled !== false;
  document.getElementById('location-auto-update').checked = config.location?.autoUpdate === true;
  syncAutomationButtons(config);

  if (!config) return;
  state.config = config;
  if (Array.isArray(cities)) state.cities = cities;

  const countrySelect = document.getElementById('settings-country-select');

  initializeGeography(null, cities, config);
  if (countrySelect && state.countries.length) {
    const selected =
      currentCountry(config.location?.countryCode) || currentCountry(config.location?.country);
    const fragment = document.createDocumentFragment();
    fragment.appendChild(new Option('اختر الدولة', ''));
    for (const country of [...state.countries].sort((a, b) => a.name.localeCompare(b.name, 'ar')))
      fragment.appendChild(new Option(country.name, country.code));
    countrySelect.replaceChildren(fragment);
    countrySelect.value = selected?.code || '';
    if (selected) {
      state.cities = state.citiesByCountry.get(selected.code) || [];
      populateCitiesDropdown(selected.code, config.location?.city);
    }
  }
  state.methodManuallySelected = config.location?.calculationMethodSelection === 'manual';
  setMethodHint();
  populateTimeZones(config.location?.timeZone);
  document.getElementById('settings-city-name').value = config.location?.city || '';
  document.getElementById('settings-country-name').value = config.location?.country || '';
  document.getElementById('settings-calc-method').value =
    config.location?.calculationMethod || 'MuslimWorldLeague';
  document.getElementById('settings-lat').value = config.location?.lat ?? 35.7595;
  document.getElementById('settings-lng').value = config.location?.lng ?? -5.834;

  document.getElementById('adj-fajr').value = config.prayerAdjustments?.fajr ?? 0;
  document.getElementById('adj-sunrise').value = config.prayerAdjustments?.sunrise ?? 0;
  document.getElementById('adj-dhuhr').value = config.prayerAdjustments?.dhuhr ?? 0;
  document.getElementById('adj-asr').value = config.prayerAdjustments?.asr ?? 0;
  document.getElementById('adj-maghrib').value = config.prayerAdjustments?.maghrib ?? 0;
  document.getElementById('adj-isha').value = config.prayerAdjustments?.isha ?? 0;

  document.getElementById('settings-pre-prayer-min').value =
    config.notifications?.prePrayerMinutes ?? 15;
  document.getElementById('settings-friday-min').value = Math.max(
    30,
    Number(config.notifications?.fridayPrePrayerMinutes) || 60,
  );

  document.getElementById('settings-lock-enabled').checked = Boolean(config.screenLock?.enabled);
  document.getElementById('settings-lock-before').value =
    config.screenLock?.minutesBeforeAdhan ?? 15;
  document.getElementById('settings-lock-snooze').value = config.screenLock?.snoozeMinutes ?? 3;

  const audioCheckEl = document.getElementById('settings-audio-enabled');
  if (audioCheckEl) {
    audioCheckEl.checked = config.notifications?.playAdhanAudio !== false;
  }

  renderNotificationPreferences(config);
  renderResourcePolicy(config);
}

// ============================================================================
// 7. Event bindings.
// ============================================================================
function bindEvents() {
  bindAdhkar();
  bindLocalSync();
  bindCustomReminders();
  bindLessonExtras();
  bindLessonCard();
  bindDesktopShortcuts();
  document.getElementById('link-automatic-settings').addEventListener('click',event=>{
    event.preventDefault();activateTabById('tab-settings');
    document.querySelector('[data-settings-section="other"]').click();
    document.getElementById('automatic-settings').scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  initializeInlineSettings();
  initializeProjectInfo();
  initializeBugReport();
  window.mihrabApi.onPrayerScheduleChanged((data) => renderPrayerTimes(data));
  window.mihrabApi.onNavigateTo((target) => {
    if (!state.youtubeState) state.pendingNavigationTarget = target;
    else
      navigateToNotification(target).catch((error) =>
        showOperationResultModal({
          success: false,
          title: 'تعذر فتح الدرس داخل التطبيق',
          summary: error.message,
        }),
      );
  });
  window.mihrabApi.onNotificationError((data) =>
    showOperationResultModal({
      success: false,
      title: 'تعذر تنفيذ التنبيه',
      summary: data.message,
    }),
  );
  initializeNavigation();
  document.getElementById('btn-toggle-youtube-manager').addEventListener('click', (event) => {
    const button = event.currentTarget,
      body = document.getElementById('youtube-manager-body');
    const opening = !isPanelOpen(body);
    setPanelOpen(body, opening);
    button.setAttribute('aria-expanded', String(opening));
    button.setAttribute('aria-label', !opening ? 'إظهار إعدادات القنوات' : 'طي إعدادات القنوات');
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activateTabById(button.dataset.tab);
      button.classList.remove('is-pulsing');
      void button.offsetWidth;
      button.classList.add('is-pulsing');
      setTimeout(() => button.classList.remove('is-pulsing'), 420);
    });
  });

  document.getElementById('theme-modern-enabled').addEventListener('change', async (event) => {
    const toggle = event.currentTarget;
    const previousTheme = state.themeState?.activeTheme;
    const remembered = localStorage.getItem('mihrab.lastModernTheme');
    const available = state.themeState?.availableThemes || [];
    const lastModern = available.find(theme => theme.id === remembered && theme.family !== 'classic');
    const themeId = toggle.checked ? (lastModern?.id || 'emerald-sanctuary') : 'classic-monochrome';
    toggle.disabled = true;
    try {
      applyThemeStateToDom(
        await window.mihrabApi.setTheme(themeId, state.themeState?.activeMode || 'dark'),
      );
    } catch (error) {
      toggle.checked = previousTheme !== 'classic-monochrome';
      showOperationResultModal({
        success: false,
        title: 'تعذر تغيير المظهر',
        summary: error.message,
      });
    } finally {
      toggle.disabled = false;
    }
  });
  document.getElementById('theme-selector').addEventListener('change', async (event) => {
    try {
      applyThemeStateToDom(
        await window.mihrabApi.setTheme(event.target.value, state.themeState?.activeMode || 'dark'),
      );
    } catch (error) {
      showOperationResultModal({
        success: false,
        title: 'تعذر تغيير المظهر',
        summary: error.message,
      });
    }
  });
  document.querySelectorAll('[data-color-mode]').forEach((button) =>
    button.addEventListener('click', async () => {
      try {
        applyThemeStateToDom(
          await window.mihrabApi.setTheme(state.themeState?.activeTheme, button.dataset.colorMode),
        );
      } catch (error) {
        showOperationResultModal({
          success: false,
          title: 'تعذر تغيير المظهر',
          summary: error.message,
        });
      }
    }),
  );

  // Discover location through IP geolocation.
  initializePrayerPageControls();
  document.getElementById('btn-sync-habous').addEventListener('click', async (event) => {
    const button = event.currentTarget,
      box = document.getElementById('official-sync-report-box');
    button.disabled = true;
    box.textContent = 'جارٍ التحقق من مواقيت المدينة المختارة…';
    try {
      const { report, prayerData, config } = await window.mihrabApi.verifyOfficialTimings();
      renderSettingsForm(config, null);
      renderPrayerTimes(prayerData);
      renderVerificationStatus(report);
      const fresh = ['verified_online', 'alternative_updated'].includes(report.status);
      const rows = Object.entries(report.discrepanciesInMinutes || {}).map(([key, minutes]) => {
        const names = {
          fajr: 'الفجر',
          sunrise: 'الشروق',
          dhuhr: 'الظهر',
          asr: 'العصر',
          maghrib: 'المغرب',
          isha: 'العشاء',
        };
        return (
          names[key] +
          ': ' +
          (report.officialTimings?.[key] || '--:--') +
          ' | التعديل: ' +
          (minutes > 0 ? '+' : '') +
          minutes +
          ' دقيقة'
        );
      });
      showOperationResultModal({
        success: fresh,
        title: 'التحقق من أوقات الصلاة',
        summary: report.message,
        details: [
          report.provider,
          report.cityName,
          report.timeZone,
          ...rows,
          report.dryRun
            ? 'معاينة فقط؛ لم تتغير الإعدادات.'
            : report.autoApplied
              ? 'تم تطبيق التحديث على المواقيت المعروضة.'
              : 'بقيت مواقيتك السابقة دون تغيير.',
          report.officialError ? 'تعذر المصدر الرسمي: ' + report.officialError : '',
          report.error,
          report.warning,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    } catch (error) {
      renderVerificationStatus({
        message:
          navigator.onLine === false
            ? OFFLINE_PRAYER_MESSAGE
            : 'تعذر تحديث المواقيت الآن؛ يرجى المحاولة لاحقاً.',
      });
      showOperationResultModal({
        success: false,
        title: 'تعذر التحقق من المواقيت',
        summary: error.message,
      });
    } finally {
      button.disabled = false;
    }
  });

  const rotateHadithHandler = async () => {
    try {
      const nextState = await window.mihrabApi.getNextHadith();
      renderHadithState(nextState);
    } catch (error) {
      showOperationResultModal({
        success: false,
        title: 'تعذر تبديل الحديث',
        summary: error.message,
      });
    }
  };
  document.getElementById('hero-rotate-hadith-btn').addEventListener('click', rotateHadithHandler);
  document.getElementById('btn-next-hadith').addEventListener('click', rotateHadithHandler);

  document.getElementById('btn-sync-hadeethenc').addEventListener('click', async () => {
    const topic = document.getElementById('hadeethenc-topic-input').value.trim() || null;
    const button = document.getElementById('btn-sync-hadeethenc');
    button.disabled = true;
    const statusEl = document.getElementById('hadeethenc-sync-status');

    statusEl.textContent = 'جارٍ جلب الأحاديث…';
    try {
      const { syncResult, hadithState } = await window.mihrabApi.syncHadeethEncHadiths(topic);
      const message = syncResult.addedCount
        ? 'أُضيف ' + syncResult.addedCount + ' حديثاً إلى المكتبة.'
        : 'مكتبتك محدّثة؛ لا توجد أحاديث جديدة.';
      briefInlineFeedback(statusEl, message);
      renderHadithState(hadithState);
      showOperationResultModal({
        success: true,
        title: 'جلب الأحاديث من موسوعة الأحاديث النبوية',
        summary: message,
        details:
          `• الموضوع: ${syncResult.topic}\n` +
          `• نص الحديث الأول: ${syncResult.sampleHadith?.text}\n` +
          `• الراوي: ${syncResult.sampleHadith?.rawi} | المحدث: ${syncResult.sampleHadith?.mohdith}\n` +
          `• البصمة الرقمية: ${syncResult.sampleHadith?.fingerprint}`,
      });
    } catch (err) {
      statusEl.textContent = `فشل الجلب: ${conciseFeedback(err.message)}`;
      showOperationResultModal({
        success: false,
        title: 'فشل جلب الأحاديث من موسوعة الأحاديث النبوية',
        summary: 'تعذر إتمام طلب الشبكة لخادم موسوعة الأحاديث النبوية.',
        details: err.message || String(err),
      });
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('btn-add-channel').addEventListener('click', async () => {
    const button = document.getElementById('btn-add-channel');
    if (button.disabled) return;
    const channelId = document.getElementById('yt-channel-id-input').value.trim();
    const customName = '';
    if (!channelId) return;
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = 'جاري التحقق...';
    try {
      const res = await window.mihrabApi.addYoutubeChannel({ channelId, customName });
      document.getElementById('yt-channel-id-input').value = '';
      renderYoutubeState(res.feeds);
      showOperationResultModal({
        success: true,
        title: 'إضافة قناة دعوية',
        summary: `تمت إضافة القناة بنجاح: ${res.channel.name}`,
        details: res.warning || `• معرّف القناة: ${res.channel.channelId}`,
      });
    } catch (err) {
      const message = err.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      );
      showOperationResultModal({
        success: false,
        title: 'فشل إضافة القناة',
        summary: message,
        details: 'تحقق من الرابط واتصال الإنترنت، ثم أعد المحاولة.',
      });
    } finally {
      button.disabled = false;
      button.innerHTML = label;
    }
  });

  const chPicker = document.getElementById('yt-channel-picker');
  if (chPicker) {
    chPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        state.selectedChannelIds.add(e.target.value);
        e.target.value = '';
        renderYoutubeState(state.youtubeState);
      }
    });
  }

  const ctxPicker = document.getElementById('yt-context-picker');
  if (ctxPicker) {
    ctxPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        state.selectedContextIds.add(e.target.value);
        e.target.value = '';
        renderYoutubeState(state.youtubeState);
      }
    });
  }

  document.getElementById('btn-refresh-yt').addEventListener('click', async () => {
    try {
      state.youtubeRefreshStarted = true;
      const feeds = await refreshYoutubeData();
      if (feeds.networkErrors?.length) reportYoutubeRefreshError(...feeds.networkErrors);
    } catch (error) {
      reportYoutubeRefreshError(error);
    }
  });

  document.getElementById('btn-cancel-delete-channel').addEventListener('click', () => {
    document.getElementById('modal-delete-channel').classList.remove('open');
    state.pendingDeleteChannel = null;
  });

  document.getElementById('btn-confirm-delete-channel').addEventListener('click', async () => {
    if (!state.pendingDeleteChannel) return;
    const channel = state.pendingDeleteChannel;
    const res = await window.mihrabApi.removeYoutubeChannel(channel.channelId);
    rememberRemovedChannel(channel);
    document.getElementById('modal-delete-channel').classList.remove('open');
    state.pendingDeleteChannel = null;
    renderYoutubeState(res.feeds);
  });

  document.getElementById('btn-open-yt-tutorial').addEventListener('click', () => {
    document.getElementById('modal-yt-tutorial').classList.add('open');
  });
  document.getElementById('btn-close-yt-tutorial').addEventListener('click', () => {
    document.getElementById('modal-yt-tutorial').classList.remove('open');
  });

  // Save Quran preferences when their controls change.
  bindWirdPositionEditors();
  document
    .getElementById('btn-complete-reading')
    .addEventListener('click', () => completeQuranWithTurn('reading', false));

  document
    .getElementById('btn-roll-random-reading')
    .addEventListener('click', () => completeQuranWithTurn('reading', true));

  document.querySelectorAll('[data-quran-mode]').forEach((button) => {
    button.addEventListener('click', () => activateQuranMode(button.dataset.quranMode));
    button.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        activateQuranMode(
          event.key === 'Home'
            ? 'reading'
            : event.key === 'End'
              ? 'hifz'
              : state.quranMode === 'hifz'
                ? 'reading'
                : 'hifz',
          true,
        );
      }
    });
  });
  document.getElementById('btn-quran-settings').addEventListener('click', (event) => {
    updateQuranSettingsSection();
    openInlineSettings(event.currentTarget, 'quran-general-settings');
  });
  document.getElementById('quran-riwaya').addEventListener('change', async () => {
    const res = await autoSaveQuranSettings();
    if (res) renderQuranState(res.quranState);
    else document.getElementById('quran-riwaya').value = state.quranState.riwaya;
  });
  for (const kind of ['reading', 'hifz'])
    document.getElementById(kind + '-prayer-enabled').addEventListener('change', () => {
      document.getElementById(kind + '-custom-enabled').checked = false;
      updateQuranTiming(kind);
    });
  document.getElementById('reading-mode').addEventListener('change', (e) => {
    const isRandom = e.target.value === 'random';
    document.getElementById('btn-complete-reading').style.display = isRandom
      ? 'none'
      : 'inline-flex';
    document.getElementById('btn-roll-random-reading').style.display = isRandom
      ? 'inline-flex'
      : 'none';
    autoSaveQuranSettings();
  });

  document.getElementById('reading-unit').addEventListener('change', () => autoSaveQuranSettings());
  document
    .getElementById('reading-amount')
    .addEventListener('change', () => autoSaveQuranSettings());

  document.getElementById('reading-custom-enabled').addEventListener('change', () => {
    updateReadingTimeToggle();
  });

  document.getElementById('hifz-unit').addEventListener('change', autoSaveQuranSettings);
  document.getElementById('hifz-amount').addEventListener('change', () => autoSaveQuranSettings());

  document.getElementById('hifz-custom-enabled').addEventListener('change', () => {
    updateHifzTimeToggle();
  });

  document
    .getElementById('btn-complete-hifz')
    .addEventListener('click', () => completeQuranWithTurn('hifz', false));

  async function applySelectedCity(selectedCity, method = null, request = state.locationRequestId) {
    const chosenMethod =
      method ||
      (state.methodManuallySelected
        ? document.getElementById('settings-calc-method').value
        : selectedCity.method);
    const location = {
      autoDetect: false,
      city: selectedCity.city,
      country: selectedCity.country,
      countryCode: selectedCity.countryCode,
      calculationMethod: chosenMethod,
      calculationMethodSelection: state.methodManuallySelected ? 'manual' : 'auto',
      timeZone: selectedCity.timeZone,
      lat: selectedCity.lat,
      lng: selectedCity.lng,
    };
    const res = await window.mihrabApi.saveSettings({ location });
    if (request !== state.locationRequestId) return;
    renderSettingsForm(res.config, null);
    renderPrayerTimes(res.prayerData);
    if (res.quranState) renderQuranState(res.quranState);
  }
  const countrySelectEl = document.getElementById('settings-country-select');
  const citySelectEl = document.getElementById('settings-city-select');
  const citySearchEl = null;
  const saveButton = document.getElementById('btn-save-region');
  const busy = (value) => {
    state.locationBusy = value;
    saveButton.disabled = value;
    document.getElementById('settings-calc-method').disabled = value;
  };
  countrySelectEl?.addEventListener('change', async (event) => {
    const country = currentCountry(event.target.value),
      request = ++state.locationRequestId;
    if (!country) return;
    busy(true);
    state.methodManuallySelected = false;
    document.getElementById('settings-calc-method').value = country.method;
    setMethodHint(false);
    document.getElementById('settings-country-name').value = country.name;
    document.getElementById('settings-city-name').value = '';
    document.getElementById('settings-lat').value = '';
    document.getElementById('settings-lng').value = '';
    citySelectEl.replaceChildren(new Option('جارٍ تحميل المدن…', ''));
    citySelectEl.disabled = true;
    try {
      const cities = await loadCountryCities(country);
      if (request !== state.locationRequestId) return;
      state.cities = cities;
      populateCitiesDropdown(country.code);
      if (cities.length) await applySelectedCity(cities[0], country.method, request);
    } catch (error) {
      if (request === state.locationRequestId)
        showOperationResultModal({
          success: false,
          title: 'تعذر تغيير الموقع',
          summary: error.message,
        });
    } finally {
      if (request === state.locationRequestId) busy(false);
    }
  });
  citySelectEl?.addEventListener('change', async (event) => {
    const country = currentCountry(countrySelectEl.value);
    const city = state.citiesByCountry
      .get(country?.code)
      ?.find((item) => item.id === event.target.value);
    if (!city) return;
    const request = ++state.locationRequestId;
    busy(true);
    try {
      await applySelectedCity(city, null, request);
    } catch (error) {
      showOperationResultModal({
        success: false,
        title: 'تعذر حفظ المدينة',
        summary: error.message,
      });
    } finally {
      if (request === state.locationRequestId) busy(false);
    }
  });
  citySearchEl?.addEventListener('input', (event) =>
    populateCitiesDropdown(countrySelectEl.value, '', event.target.value),
  );
  document.getElementById('settings-calc-method').addEventListener('change', () => {
    state.methodManuallySelected = true;
    setMethodHint(true);
    for (const key of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'])
      document.getElementById('adj-' + key).value = 0;
  });

  document.getElementById('btn-preview-warning').addEventListener('click', async () => {
    try {
      await window.mihrabApi.previewPreLockWarning();
      showOperationResultModal({
        success: true,
        title: 'تنبيه شاشة التهيئة',
        summary: 'تم إطلاق معاينة إشعار قفل الشاشة.',
        details: 'جرّب زر التمديد داخل الإشعار نفسه؛ هذه المعاينة لا تُنشئ قفلاً فعلياً.',
      });
    } catch (err) {
      showOperationResultModal({
        success: false,
        title: 'فشل معاينة التنبيه',
        summary: 'حدث خطأ أثناء إطلاق تنبيه ما قبل القفل.',
        details: err.message || String(err),
      });
    }
  });

  document.getElementById('btn-preview-lock').addEventListener('click', async () => {
    try {
      await window.mihrabApi.previewScreenLock({ durationSeconds: 30, isTestMode: true });
    } catch (err) {
      showOperationResultModal({
        success: false,
        title: 'فشل تشغيل شاشة التهيؤ',
        summary: 'تعذر فتح نافذة التجميد.',
        details: err.message || String(err),
      });
    }
  });

  const closeOpModal = () => {
    document.getElementById('modal-operation-result').classList.remove('open');
  };
  document.getElementById('btn-close-op-modal').addEventListener('click', closeOpModal);
  document.getElementById('btn-ok-op-modal').addEventListener('click', closeOpModal);
  document.getElementById('btn-op-modal-extra-link').addEventListener('click', () => {
    if (state.extraModalUrl) {
      window.mihrabApi.openExternalUrl(state.extraModalUrl);
    }
  });
}

async function navigateToNotification(target) {
  state.pendingNavigationTarget = null;
  if (target.tabId !== 'tab-youtube') return activateTabById(target.tabId);
  if (target.lesson || target.videoId) return openLessonCard(target);
  state.recommendedVideoId = target.videoId || null;
  state.selectedChannelIds.clear();
  state.selectedContextIds.clear();
  if (target.channelId) state.selectedChannelIds.add(target.channelId);
  const cached = await window.mihrabApi.getYoutubeState();
  renderYoutubeState(cached);
  activateTabById('tab-youtube');
}

// ============================================================================
// 8. Renderer startup.
// ============================================================================
async function initApp() {
  bindEvents();
  window.mihrabApi.onAutomationStatus?.(data=>{const node=document.getElementById("automatic-settings-status");node.textContent=data.message||"";node.dataset.state=data.error?"error":"success";});
  bindHadithLibraryEvents();
  const data = await window.mihrabApi.getBootstrapData();

  initializePerformance(data.performanceProfile);
  initializeAccessibility(data.config.accessibility);
  applyThemeStateToDom(data.themeState);
  initializeGeography(data.countries, data.cities, data.config);
  renderSettingsForm(data.config, data.cities);
  renderPrayerTimes(data.prayerData);
  renderHadithState(data.hadithState);
  renderQuranState(data.quranState);
  initializeUpdates();
  renderYoutubeState(data.youtubeState);
  initializeHadithImagePreview();
  initializeFinalPolish();
  document.getElementById('btn-update-highlights').addEventListener('click', () => {
    document.getElementById('update-highlights').showModal();
  });
  showUpdateHighlights();
  resetSettingsDraftBaselines();
  if (state.pendingNavigationTarget) await navigateToNotification(state.pendingNavigationTarget);

  updateLiveClockAndCountdown();
  resumeVisibleClock();
  if (document.getElementById('tab-youtube').classList.contains('active')) ensureYoutubeRefresh();

  window.mihrabApi.onThemeLiveReloaded((updatedThemeState) => {
    applyThemeStateToDom(updatedThemeState);
  });

  window.mihrabApi.onSyncApplied?.(({ config, prayerData, quranState, youtubeState }) => {
    state.config = config;
    if (prayerData) {
      const drafts = new Map(dirtySettingsGroups().map(group => [group, settingsGroupSnapshot(group)]));
      renderSettingsForm(config, null);
      discardSettingsDrafts(drafts, true);
      renderPrayerTimes(prayerData);
      refreshCurrentCountryCities(config.location).catch(error => console.warn('Synced region:', error.message));
    }
    if (quranState) renderQuranState(quranState);
    if (youtubeState) renderYoutubeState(youtubeState);
    window.dispatchEvent(new Event('mihrab-sync-applied'));
  });

  if (window.mihrabApi.onConfigUpdated) {
    window.mihrabApi.onConfigUpdated((newConfig) => {
      renderSettingsForm(newConfig, null);
      refreshCurrentCountryCities(newConfig.location).catch((error) =>
        showOperationResultModal({
          success: false,
          title: 'تعذر تحميل المدن',
          summary: error.message,
        }),
      );
    });
  }

  window.mihrabApi.onPrayerReached(({ hadithState, prayerData }) => {
    renderHadithState(hadithState);
    if (prayerData) renderPrayerTimes(prayerData);
  });

  window.mihrabApi.onLockscreenClosed((result) => {
    showOperationResultModal({
      success: result?.audioRestored !== false,
      title: 'انتهاء / إغلاق شاشة التهيؤ للصلاة',
      summary: 'تم إغلاق شاشة التهيؤ واستعادة شريط مهام ويندوز والصوت بنجاح.',
      details:
        result?.audioRestored === false
          ? result.error
          : 'أُغلقت نافذة التهيئة واستُعيدت حالة الصوت المحفوظة.',
    });
  });
}

window.addEventListener('online', () => renderVerificationStatus());
window.addEventListener('offline', () => renderVerificationStatus());

window.addEventListener(
  'DOMContentLoaded',
  () => {
    uiMotion.init();
    initApp().then(()=>window.MihrabBoot.ready()).catch(error=>window.MihrabBoot.fail(error));
  },
  { once: true },
);
window.addEventListener(
  'pagehide',
  () => {
    uiMotion.dispose();
    clearTimeout(feedbackTimer);


    clearTimeout(hadithSearchTimer);
    hadithLibraryRequest++;
    hadithDetailsRequest++;
    if (state.clockTimerId) clearInterval(state.clockTimerId);
    lessonFeed?.dispose();
  },
  { once: true },
);

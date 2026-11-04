const channelAvatarObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      channelAvatarObserver.unobserve(entry.target);
      const row = entry.target;
      if (
        !window.mihrabPerformance.profile.images ||
        state.config?.network?.enabled === false ||
        state.config?.network?.categories?.youtube === false
      )
        return;
      window.mihrabApi
        .getChannelAvatar(row.dataset.avatarId)
        .then((url) => {
          if (!url || !row.isConnected) return;
          const img = document.createElement('img');
          img.className = 'channel-avatar';
          img.alt = '';
          img.loading = 'lazy';
          img.src = url;
          img.onerror = () => img.remove();
          row.querySelector('.channel-avatar')?.replaceWith(img);
        })
        .catch((error) => {
          row.title = 'تعذر تحميل صورة القناة: ' + error.message;
        });
    }
  },
  { rootMargin: '40px' },
);
function observeChannelAvatar(row, id) {
  row.dataset.avatarId = id;
  channelAvatarObserver.observe(row);
}
const customSelects = new Map();
let openCustomSelect = null;
const panelMotions = new Map();

function motionDuration() {
  const root = document.documentElement;
  return root.dataset.a11yMotion === 'reduce' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    root.dataset.performance === 'eco'
    ? 0
    : root.dataset.performance === 'balanced'
      ? 140
      : 280;
}
function isPanelOpen(node) {
  return panelMotions.get(node)?.open ?? !node.hidden;
}
function animatePanel(node) {
  panelMotions.get(node)?.animation?.cancel();
  panelMotions.delete(node);
  const ms = motionDuration();
  if (!ms || !node?.checkVisibility()) return;
  // Anchored overlays own their CSS transition; never animate their coordinates twice.
  const translate =
    document.documentElement.dataset.performance !== 'balanced' &&
    !node.matches('[popover], dialog');
  const animation = node.animate(
    translate
      ? [
          { opacity: 0.15, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ]
      : [{ opacity: 0.3 }, { opacity: 1 }],
    { duration: ms, easing: 'cubic-bezier(.16,1,.3,1)' },
  );
  const job = { animation, open: true };
  panelMotions.set(node, job);
  animation.finished
    .catch(() => {})
    .finally(() => {
      if (panelMotions.get(node) === job) panelMotions.delete(node);
    });
  return animation;
}
async function setPanelOpen(node, open) {
  const opacity = getComputedStyle(node).opacity;
  panelMotions.get(node)?.animation?.cancel();
  panelMotions.delete(node);
  if (open) {
    node.hidden = false;
    animatePanel(node);
    return;
  }
  const ms = motionDuration();
  if (!ms || node.hidden) {
    node.hidden = true;
    return;
  }
  const job = {
    open: false,
    animation: node.animate([{ opacity }, { opacity: 0 }], { duration: ms }),
  };
  panelMotions.set(node, job);
  try {
    await job.animation.finished;
    if (panelMotions.get(node) === job) node.hidden = true;
  } catch (_) {
    /* A newer interaction owns the final visibility. */
  } finally {
    if (panelMotions.get(node) === job) panelMotions.delete(node);
  }
}
function refreshCustomSelects() {
  for (const control of customSelects.values()) control.sync();
}

// One set of viewport listeners, active only for the currently open menu.
document.addEventListener(
  'scroll',
  (event) => {
    if (openCustomSelect && !openCustomSelect.pop.contains(event.target))
      openCustomSelect.position();
  },
  true,
);
window.addEventListener('resize', () => openCustomSelect?.position());
window.visualViewport?.addEventListener('resize', () => openCustomSelect?.position());
document.addEventListener('click', () => queueMicrotask(() => openCustomSelect?.position()));
new MutationObserver((records) => {
  if (records.some((record) => record.attributeName === 'disabled')) refreshCustomSelects();
  openCustomSelect?.position();
}).observe(document.documentElement, {
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden', 'disabled'],
});
function finishPanelMotions() {
  if (motionDuration()) return;
  for (const { animation } of panelMotions.values()) animation.finish();
}
new MutationObserver(finishPanelMotions).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-performance', 'data-a11y-motion'],
});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', finishPanelMotions);

function installCustomSelect(select) {
  if (customSelects.has(select) || select.multiple) return;
  const wrap = document.createElement('div');
  wrap.className = 'custom-select';
  const labels = [...select.labels];
  select.before(wrap);
  wrap.append(select);
  select.classList.add('native-select-source');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const key = select.id || 'select-' + customSelects.size;
  const input = document.createElement('input');
  input.id = 'input-' + key;
  input.className = 'input-field custom-select-input';
  input.dataset.selectSearch = '';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-haspopup', 'listbox');
  input.autocomplete = 'off';
  const label =
    labels.map((node) => node.textContent.trim()).join(' ') ||
    select.getAttribute('aria-label') ||
    select.closest('.form-group')?.querySelector('label')?.textContent ||
    'اختر من القائمة';
  input.setAttribute('aria-label', label);
  for (const node of labels) node.htmlFor = input.id;
  wrap.append(input);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'custom-select-toggle';
  toggle.tabIndex = -1;
  toggle.setAttribute('aria-label', 'فتح أو إغلاق قائمة ' + label);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML =
    '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>';
  wrap.append(toggle);
  const pop = document.createElement('div');
  pop.className = 'custom-select-menu';
  pop.setAttribute('popover', 'auto');
  pop.setAttribute('role', 'listbox');
  pop.setAttribute('aria-label', label);
  pop.id = 'options-' + key;
  input.setAttribute('aria-controls', pop.id);
  toggle.setAttribute('aria-controls', pop.id);
  wrap.append(pop);
  let rows = [],
    active = -1,
    searching = false,
    frame = 0,
    toggleWasOpen = null,
    inputPointerState = null;
  const isOpen = () => pop.matches(':popover-open');
  const expanded = (value) => {
    input.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-expanded', String(value));
    wrap.classList.toggle('is-open', value);
  };
  const close = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (isOpen()) pop.hidePopover();
    if (openCustomSelect?.pop === pop) openCustomSelect = null;
    searching = false;
    expanded(false);
    input.removeAttribute('aria-activedescendant');
    input.value = select.selectedOptions[0]?.textContent || '';
  };
  const position = () => {
    if (!isOpen()) return;
    if (!input.checkVisibility() || select.matches(':disabled')) {
      close();
      return;
    }
    const rect = input.getBoundingClientRect(),
      margin = 8,
      gap = 5;
    // A scrolled-out field must not leave a detached menu over the next card.
    for (
      let parent = wrap.parentElement;
      parent && parent !== document.body;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent),
        bounds = parent.getBoundingClientRect();
      if (
        /(auto|scroll|hidden|clip)/.test(style.overflowY) &&
        (rect.bottom <= bounds.top || rect.top >= bounds.bottom)
      ) {
        close();
        return;
      }
      if (
        /(auto|scroll|hidden|clip)/.test(style.overflowX) &&
        (rect.right <= bounds.left || rect.left >= bounds.right)
      ) {
        close();
        return;
      }
    }
    // A top-layer popover is viewport-positioned. Reset every UA inset, especially right in RTL.
    const width = Math.min(rect.width, innerWidth - margin * 2);
    const below = Math.max(0, innerHeight - rect.bottom - gap - margin),
      above = Math.max(0, rect.top - gap - margin);
    if (rect.bottom <= margin || rect.top >= innerHeight - margin) {
      close();
      return;
    }
    const upwards = below < Math.min(200, pop.scrollHeight) && above > below;
    const available = Math.min(280, upwards ? above : below);
    pop.style.width = width + 'px';
    pop.style.maxHeight = available + 'px';
    pop.style.left = Math.max(margin, Math.min(innerWidth - width - margin, rect.left)) + 'px';
    pop.style.top = (upwards ? rect.top - gap - pop.offsetHeight : rect.bottom + gap) + 'px';
    pop.dataset.placement = upwards ? 'above' : 'below';
  };
  const sync = () => {
    const disabled = select.matches(':disabled');
    if (input.disabled !== disabled) input.disabled = disabled;
    if (toggle.disabled !== disabled) toggle.disabled = disabled;
    const searchable = options().length > 20;
    input.readOnly = !searchable;
    input.setAttribute('aria-autocomplete', searchable ? 'list' : 'none');
    wrap.dataset.searchable = String(searchable);
    if (!searchable) searching = false;
    input.placeholder = searchable ? 'ابحث أو اختر…' : 'اختر من القائمة';
    if (input.disabled && isOpen()) close();
    if (!searching) input.value = select.selectedOptions[0]?.textContent || '';
  };
  const fold = (value) =>
    String(value)
      .normalize('NFKD')
      .replace(/[\u064b-\u065f\u0670\u0300-\u036f]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .toLowerCase();
  const options = () =>
    select.id === 'settings-city-select'
      ? (
          state.citiesByCountry.get(
            currentCountry(document.getElementById('settings-country-select').value)?.code,
          ) || []
        ).map((city) => ({
          value: city.id,
          textContent:
            city.city +
            (city.nativeName && city.nativeName !== city.city ? ' — ' + city.nativeName : ''),
          search: [city.city, city.nativeName, city.asciiName].join(' '),
        }))
      : [...select.options].filter(
          (option) => !option.disabled && !option.closest('optgroup[disabled]'),
        );
  const choose = (row) => {
    if (![...select.options].some((option) => option.value === row.value))
      select.add(new Option(row.textContent, row.value));
    select.value = row.value;
    close();
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    input.focus({ preventScroll: true });
  };
  const draw = (query) => {
    pop.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    rows = options()
      .filter(
        (option) =>
          !option.disabled && fold(option.search || option.textContent).includes(fold(query)),
      )
      .slice(0, 150);
    for (const [index, row] of rows.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'option');
      button.id = pop.id + '-' + index;
      button.setAttribute('aria-selected', String(row.value === select.value));
      button.textContent = row.textContent;
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => choose(row));
      pop.append(button);
    }
    if (!rows.length) pop.textContent = 'لا توجد نتيجة مطابقة.';
    position();
  };
  const control = { sync, pop, position, close };
  const open = (selectText = false) => {
    if (select.matches(':disabled') || !input.checkVisibility()) return;
    if (isOpen()) return;
    openCustomSelect?.close();
    searching = false;
    sync();
    draw('');
    pop.showPopover({ source: input });
    openCustomSelect = control;
    expanded(true);
    position();
    if (selectText) {
      input.focus({ preventScroll: true });
      if (!input.readOnly) input.select();
    }
    // Follow an entering ancestor for its brief motion, with no idle animation loop.
    const until = performance.now() + (motionDuration() ? 420 : 0);
    const follow = () => {
      frame = 0;
      if (!isOpen()) return;
      position();
      if (isOpen() && performance.now() < until) frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
  };
  input.addEventListener('pointerdown', () => {
    inputPointerState = { wasOpen: isOpen(), query: input.value, searching };
  });
  input.addEventListener('pointercancel', () => {
    inputPointerState = null;
  });
  input.addEventListener('click', () => {
    const prior = inputPointerState;
    inputPointerState = null;
    if (input.readOnly) {
      if (prior?.wasOpen ?? isOpen()) {
        close();
        input.focus({ preventScroll: true });
      } else open(true);
      return;
    }
    if (prior?.wasOpen && !isOpen()) {
      // Some Chromium versions light-dismiss on the search field itself.
      const start = input.selectionStart,
        end = input.selectionEnd;
      open();
      searching = prior.searching;
      if (searching) {
        input.value = prior.query;
        draw(prior.query);
        input.setSelectionRange(start, end);
      }
    } else open(true);
  });
  toggle.addEventListener('pointerdown', (event) => {
    toggleWasOpen = isOpen();
    event.preventDefault();
  });
  toggle.addEventListener('pointercancel', () => {
    toggleWasOpen = null;
  });
  toggle.addEventListener('click', () => {
    // Native light-dismiss can run between pointerdown and click; retain the user's intent.
    const wasOpen = toggleWasOpen ?? isOpen();
    toggleWasOpen = null;
    if (wasOpen) {
      close();
      input.focus({ preventScroll: true });
    } else open(true);
  });
  input.addEventListener('input', () => {
    if (input.readOnly) {
      sync();
      return;
    }
    const query = input.value;
    open();
    searching = true;
    input.value = query;
    draw(query);
  });
  input.addEventListener('keydown', (event) => {
    if (input.readOnly && event.key === ' ') {
      event.preventDefault();
      if (isOpen()) close();
      else open(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
      if (!rows.length) return;
      active =
        active < 0
          ? event.key === 'ArrowDown'
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      [...pop.children].forEach((button, index) =>
        button.classList.toggle('highlighted', index === active),
      );
      input.setAttribute('aria-activedescendant', pop.children[active].id);
      pop.children[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen() && active >= 0) choose(rows[active]);
      else open(true);
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close();
  });
  pop.addEventListener('toggle', () => {
    if (!isOpen()) close();
    else expanded(true);
  });
  input.addEventListener('blur', () => {
    if (!isOpen()) sync();
  });
  select.addEventListener('change', () => {
    searching = false;
    sync();
  });
  new MutationObserver(() => {
    sync();
    if (isOpen()) draw(searching ? input.value : '');
  }).observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'label', 'selected'],
  });
  new ResizeObserver(position).observe(input);
  customSelects.set(select, control);
  sync();
}

function installDetailsMotion(details) {
  const summary = details.querySelector(':scope > summary');
  let job = null,
    intendedOpen = details.open;
  summary?.addEventListener('click', async (event) => {
    const ms = motionDuration();
    if (!ms && !job) return;
    event.preventDefault();
    const opening = job ? !intendedOpen : !details.open,
      from = details.getBoundingClientRect().height;
    job?.animation.cancel();
    intendedOpen = opening;
    details.open = false;
    const closed = details.getBoundingClientRect().height;
    details.open = true;
    const expanded = details.getBoundingClientRect().height;
    if (!ms) {
      details.open = opening;
      details.style.removeProperty('overflow');
      job = null;
      return;
    }
    details.style.overflow = 'hidden';
    const current = {
      open: opening,
      animation: details.animate(
        [{ height: from + 'px' }, { height: (opening ? expanded : closed) + 'px' }],
        { duration: ms, easing: 'cubic-bezier(.16,1,.3,1)' },
      ),
    };
    job = current;
    panelMotions.set(details, current);
    try {
      await current.animation.finished;
    } catch (_) {
      /* Rapid toggles replace the previous motion. */
    } finally {
      if (job === current) {
        details.open = intendedOpen;
        details.style.removeProperty('overflow');
        job = null;
        panelMotions.delete(details);
      }
    }
  });
}

function updateDirtyBadges() {
  for (const button of document.querySelectorAll('[data-settings-section],[data-notice-section]')) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) continue;
    let dirty = false;
    if (button.hasAttribute('data-settings-section'))
      dirty = dirtySettingsGroups().includes(
        {
          notifications: 'notifications',
          screen: 'screen',
          resources: 'resources',
          performance: 'performance',
          updates: 'updates',
          other:'other',
        }[button.dataset.settingsSection],
      );
    if (button.hasAttribute('data-notice-section')) {
      const base = new Map(JSON.parse(settingsDraftBaselines.get('notifications') || '[]'));
      dirty = [...panel.querySelectorAll('input:not([data-select-search]),select')].some(
        (n) =>
          base.has(n.id) &&
          base.get(n.id) !== (['checkbox', 'radio'].includes(n.type) ? n.checked : n.value),
      );
    }
    button.classList.toggle('has-unsaved', dirty);
    button.setAttribute(
      'aria-label',
      button.textContent.trim() + (dirty ? ' — تغييرات غير محفوظة' : ''),
    );
  }
  refreshSettingsDraftStatus();
}
function discardSettingsDrafts(snapshots = settingsDraftBaselines, quiet = false) {
  for (const [group, raw] of snapshots) {
    const base = JSON.parse(raw);
    if (['notifications', 'screen'].includes(group)) {
      for (const [id, value] of base) {
        const n = document.getElementById(id);
        if (n) {
          if (['checkbox', 'radio'].includes(n.type)) n.checked = value;
          else n.value = value;
        }
      }
    } else if (group === 'other') {
      document.getElementById('auto-prayer-verification').checked=base.automation.verifyPrayerTimes;
      document.getElementById('location-auto-update').checked=base.location.autoUpdate;
    } else if (group === 'performance') {setPerformanceChoice(base);lastPerformanceDraft=base;}
    else if (group === 'resources') renderResourcePolicy({ network: base });
    else if (group === 'updates')
      for (const [id, key] of [
        ['update-enabled', 'enabled'],
        ['update-auto-download', 'autoDownload'],
        ['update-prerelease', 'prerelease'],
      ])
        document.getElementById(id).checked = base[key];
  }
  syncNotificationControls();
  refreshCustomSelects();
  updateDirtyBadges();
  if (!quiet)
    briefInlineFeedback(
      document.getElementById('settings-save-status'),
      'أُلغيَت جميع التعديلات غير المحفوظة.',
    );
}
function initializeFinalPolish() {
  window.mihrabApi.onRegionUpdated?.((config) => {
    const drafts = new Map(
      dirtySettingsGroups().map((group) => [group, settingsGroupSnapshot(group)]),
    );
    renderSettingsForm(config, null);
    discardSettingsDrafts(drafts, true);
  });
  document.getElementById('btn-open-mini-prayer').addEventListener('click', () =>
    window.mihrabApi.toggleMiniPrayer().catch((error) =>
      showOperationResultModal({
        success: false,
        title: 'تعذر فتح العرض المصغّر',
        summary: error.message,
      }),
    ),
  );
  document.querySelectorAll('select').forEach(installCustomSelect);
  for (const name of ['renderSettingsForm', 'populateCitiesDropdown']) {
    const original = window[name];
    if (original)
      window[name] = function (...args) {
        const value = original(...args);
        refreshCustomSelects();
        return value;
      };
  }
  document.querySelectorAll('input[type=radio]').forEach((n) => {
    const label = n.closest('label');
    if (label) label.classList.add('unified-radio');
  });
  document.addEventListener('click', () => queueMicrotask(updateDirtyBadges));
  document.addEventListener('change', () => queueMicrotask(updateDirtyBadges));
  document.addEventListener('input', () => queueMicrotask(updateDirtyBadges));
  const originalCommit = commitSettingsGroups;
  commitSettingsGroups = async (...args) => {
    const value = await originalCommit(...args);
    updateDirtyBadges();
    return value;
  };
  document.getElementById('btn-discard-settings-and-leave').addEventListener('click', () => {
    if (settingsLeaveSaving) return;
    discardSettingsDrafts();
    const target = settingsLeaveTarget;
    settingsLeaveTarget = null;
    document.getElementById('unsaved-settings-dialog').close();
    if (target) activateTabById(target);
  });
  const chartToggle = document.getElementById('btn-toggle-usage-chart'),
    chart = document.getElementById('usage-chart');
  const syncChart = () => {
    const open = document.getElementById('network-show-chart').checked;
    chartToggle.textContent = open ? 'إخفاء مبيان الاستهلاك' : 'إظهار مبيان الاستهلاك';
    chartToggle.setAttribute('aria-expanded', String(open));
  };
  chartToggle.addEventListener('click', () => {
    const box = document.getElementById('network-show-chart');
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    syncChart();
    if (box.checked) animatePanel(chart);
  });
  syncChart();
  const originalResourceSync = syncResourceSettings;
  syncResourceSettings = function () {
    originalResourceSync();
    syncChart();
  };
  document.querySelectorAll('details').forEach(installDetailsMotion);
  new MutationObserver((records) => {
    const shown = [...new Set(records.map((record) => record.target))].filter(
      (node) => !node.hidden && node.checkVisibility(),
    );
    for (const node of shown) {
      if (
        panelMotions.has(node) ||
        node.closest('.custom-select') ||
        node.classList.contains('settings-transition-panel')
      )
        continue;
      if (shown.some((parent) => parent !== node && parent.contains(node))) continue;
      let parent = node.parentElement,
        animated = false;
      while (parent && parent.id !== 'tab-settings') {
        if (parent.getAnimations().some((animation) => animation.playState === 'running')) {
          animated = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!animated) animatePanel(node);
    }
  }).observe(document.getElementById('tab-settings'), {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  document
    .getElementById('btn-lock-purpose')
    .addEventListener('click', () => document.getElementById('lock-purpose-dialog').showModal());
  document
    .getElementById('btn-close-lock-purpose')
    .addEventListener('click', () => document.getElementById('lock-purpose-dialog').close());
  channelMarquee = new ChannelMarquee(document.getElementById('yt-channels-list'));
}

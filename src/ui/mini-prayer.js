let miniData = null,
  cities = [],
  miniRequest = 0,
  miniMethodManual = false;
function applyMiniTheme(themeState) {
  const root = document.documentElement;
  root.dataset.theme = themeState?.activeTheme || '';
  for (const [key, value] of Object.entries(themeState?.cssVariables || {}))
    root.style.setProperty(key, value);
}

function renderMini(data) {
  miniData = data;
  if (data.resetEditor) {
    document.getElementById('mini-region').hidden = true;
    document.getElementById('mini-toggle-region').textContent = 'إعدادات المنطقة';
    document.getElementById('mini-toggle-region').setAttribute('aria-expanded', 'false');
  }
  applyMiniTheme(data.themeState);
  document.documentElement.dataset.performance =
    data.motion === 0 ? 'eco' : data.motion <= 140 ? 'balanced' : 'full';
  document.documentElement.dataset.a11yMotion = data.motion === 0 ? 'reduce' : 'system';
  document.documentElement.style.setProperty('--mini-duration', data.motion + 'ms');
  document.getElementById('mini-city').textContent = data.prayerData.location.city;
  updateMiniClock();
}
function updateMiniClock() {
  if (!miniData) return;
  const display = MihrabPrayerDisplay.select(miniData.prayerData);
  if (!display) return;
  const elapsed = display.mode === 'elapsed';
  document.getElementById('mini-next').textContent =
    (elapsed ? 'مضى على أذان: ' : 'الصلاة القادمة: ') + display.prayer.name;
  document.getElementById('mini-countdown').textContent =
    (elapsed ? '+' : '−') + MihrabPrayerDisplay.clock(display.seconds);
  document.getElementById('mini-at').textContent =
    display.prayer.time12 ||
    new Intl.DateTimeFormat('ar', {
      timeZone:
        miniData.prayerData.location.effectiveTimeZone || miniData.prayerData.location.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(display.prayer.time));
  const hero = document.getElementById('mini-hero');
  if (hero.dataset.prayer !== display.prayer.id) {
    hero.dataset.prayer = display.prayer.id;
    hero.style.setProperty('--mini-prayer-photo', `url('assets/sun/${display.prayer.id}.png')`);
  }
}

async function loadMiniCities() {
  const request = ++miniRequest,
    select = document.getElementById('mini-city-select');
  select.disabled = true;
  document.getElementById('mini-save').disabled = true;
  try {
    cities = await window.mihrabApi.getCountryCities(document.getElementById('mini-country').value);
    if (request !== miniRequest) return;
    select.replaceChildren(...cities.map((c) => new Option(c.city, c.id)));
    const match = cities.find((c) => c.city === miniData.prayerData.location.city);
    if (match) select.value = match.id;
    select.disabled = !cities.length;
    refreshCustomSelects();
    document.getElementById('mini-save').disabled = !cities.length;
  } catch (e) {
    document.getElementById('mini-status').textContent = e.message;
  }
}
document.getElementById('mini-close').onclick = () => window.mihrabApi.hideMiniPrayer();
document.getElementById('mini-open-main').onclick = () => window.mihrabApi.openMiniMain();
document.getElementById('mini-toggle-region').onclick = async () => {
  const panel = document.getElementById('mini-region');
  const open = !isPanelOpen(panel);
  await window.mihrabApi.resizeMiniPrayer(open);
  await setPanelOpen(panel, open);
  document.getElementById('mini-toggle-region').textContent = open
    ? 'إخفاء إعدادات المنطقة'
    : 'إعدادات المنطقة';
  document.getElementById('mini-toggle-region').setAttribute('aria-expanded', String(open));
  if (open) {
    document.getElementById('mini-country').value = miniData.prayerData.location.countryCode;
    document.getElementById('mini-method').value = miniData.prayerData.location.calculationMethod;
    miniMethodManual = miniData.locationSelection === 'manual';
    refreshCustomSelects();
    await loadMiniCities();
  }
};
document.getElementById('mini-country').onchange = () => {
  miniMethodManual = false;
  document.getElementById('mini-method').value =
    miniData.countries.find((c) => c.code === document.getElementById('mini-country').value)
      ?.method || 'MuslimWorldLeague';
  refreshCustomSelects();
  loadMiniCities();
};
document.getElementById('mini-method').onchange = () => {
  miniMethodManual = true;
};
document.getElementById('mini-save').onclick = async () => {
  const city = cities.find((c) => c.id === document.getElementById('mini-city-select').value);
  if (!city) return;
  try {
    await window.mihrabApi.saveMiniRegion({
      countryCode: document.getElementById('mini-country').value,
      cityId: city.id,
      calculationMethod: document.getElementById('mini-method').value,
      manual: miniMethodManual,
    });
    renderMini(await window.mihrabApi.getMiniPrayer());
    document.getElementById('mini-status').textContent = 'تم حفظ المنطقة وتحديث المواقيت.';
  } catch (e) {
    document.getElementById('mini-status').textContent = e.message;
  }
};
window.mihrabApi.onThemeLiveReloaded(applyMiniTheme);
window.mihrabApi.onMiniPrayer((data) => {
  renderMini(data);
});
window.mihrabApi
  .getMiniPrayer()
  .then((data) => {
    renderMini(data);
    document
      .getElementById('mini-country')
      .replaceChildren(...data.countries.map((c) => new Option(c.name, c.code)));
    document.getElementById('mini-country').value = data.prayerData.location.countryCode;
    document.querySelectorAll('select').forEach(installCustomSelect);
  })
  .catch((e) => (document.getElementById('mini-status').textContent = e.message));
setInterval(updateMiniClock, 1000);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.mihrabApi.hideMiniPrayer();
});

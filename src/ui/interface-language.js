(() => {
  const languages = ['ar', 'en', 'id', 'ur', 'bn', 'fr', 'tr'];
  const rtlLanguages = new Set(['ar', 'ur']);
  const storageKey = 'mihrab.interfaceLanguage';
  const api = window.mihrabApi;
  let language = 'ar';
  let arabic = {};
  let messages = {};
  let exact = new Map();
  let patterns = [];
  let requests = 0;
  const protectedContent = [
    '[data-no-ui-translation]', 'script', 'style', 'code',
    '.hadith-quote-box', '#popup-hadith-text', '#popup-hadith-source',
    '.quran-verse', '.quran-ayah', '.adhkar-text', '[data-ayah]', '[data-bank-value]',
    '#main-hadith-text', '#hero-hadith-preview', '#hadith-explanation',
    '#lock-hadith-text', '#adhkar-source-text', '.hadith-library-preview', '.hadith-vocabulary-item'
  ].join(',');
  const seen = new WeakMap();
  const attributes = ['aria-label', 'title', 'placeholder'];

  function t(key, values = {}) {
    return (messages[key] ?? arabic[key] ?? key).replace(
      /\{(\w+)\}/g, (token, name) => String(values[name] ?? token)
    );
  }

  function localize(value) {
    if (language === 'ar' || typeof value !== 'string') return value;
    const source = value.trim().replace(/\s+/gu, ' ');
    if (exact.has(source)) return t(exact.get(source));
    for (const [key, pattern, names] of patterns) {
      const match = pattern.exec(source);
      if (!match) continue;
      return t(key, Object.fromEntries(names.map((name, index) => {
        const part = match[index + 1];
        return [name, ['prayer', 'topic', 'city', 'grade'].includes(name) ? localize(part) : part];
      })));
    }
    return value;
  }

  function setValue(node, field, value, write) {
    let fields = seen.get(node);
    const prior = fields?.get(field);
    const source = prior && prior.rendered === value ? prior.source : value;
    const marker = field === 'text' ? node.previousSibling : null;
    const key = marker?.nodeType === Node.COMMENT_NODE && marker.data.startsWith('i18n:')
      ? marker.data.slice(5) : null;
    const label = key && Object.hasOwn(arabic, key) &&
      (!prior || prior.rendered === value) ? t(key) : localize(source);
    const rendered = field === 'text' && label !== source
      ? (source.match(/^\s*/u)?.[0] ?? '') + label.trim() + (source.match(/\s*$/u)?.[0] ?? '')
      : label;
    if (!prior && rendered === value) return;
    if (!fields) seen.set(node, fields = new Map());
    fields.set(field, { source, rendered });
    if (rendered !== value) write(rendered);
  }

  function update(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentElement && !node.parentElement.closest(protectedContent)) {
        setValue(node, 'text', node.data, value => { node.data = value; });
      }
      return;
    }
    if (!(node instanceof Element) || node.closest(protectedContent)) return;
    for (const name of attributes) {
      if (node.hasAttribute(name)) {
        setValue(node, name, node.getAttribute(name), value => node.setAttribute(name, value));
      }
    }
    if (node.tagName !== 'TEXTAREA') for (const child of node.childNodes) update(child);
  }

  function compile() {
    exact = new Map();
    patterns = [];
    for (const [key, value] of Object.entries(arabic)) {
      if (!Object.hasOwn(messages, key)) continue;
      const source = value.trim().replace(/\s+/gu, ' ');
      if (!source.includes('{')) {
        if (!exact.has(source)) exact.set(source, key);
        continue;
      }
      const tokens = source.split(/\{(\w+)\}/);
      const names = tokens.filter((_, i) => i % 2);
      const regex = tokens.map((part, i) =>
        i % 2 ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      ).join('');
      patterns.push([key, new RegExp('^' + regex + '$', 'u'), names, tokens.filter((_, i) => !(i % 2)).join('').length]);
    }
    patterns.sort((a, b) => b[3] - a[3]);
  }

  async function catalog(code) {
    if (api?.getInterfaceCatalog) return api.getInterfaceCatalog(code);
    const response = await fetch(new URL('./locales/' + code + '.json', location.href));
    if (!response.ok) throw new Error('Could not load interface language ' + code);
    return response.json();
  }

  async function apply(code) {
    if (!languages.includes(code)) code = 'ar';
    const request = ++requests;
    const [base, selected] = await Promise.all([catalog('ar'), code === 'ar' ? null : catalog(code)]);
    if (request !== requests) return false;
    language = code;
    arabic = base;
    messages = selected || base;
    compile();
    document.documentElement.lang = code;
    document.documentElement.dir = rtlLanguages.has(code) ? 'rtl' : 'ltr';
    update(document.documentElement);
    return true;
  }

  async function initialize() {
    const code = api?.getInterfaceLanguage ? await api.getInterfaceLanguage() : localStorage.getItem(storageKey);
    await apply(code);
    const select = document.getElementById('mihrab-interface-language');
    if (!select) return;
    select.value = language;
    select.addEventListener('change', async () => {
      select.disabled = true;
      const previous = language;
      const code = select.value;
      try {
        if (await apply(code)) {
          if (api?.setInterfaceLanguage) await api.setInterfaceLanguage(code);
          else localStorage.setItem(storageKey, code);
          window.dispatchEvent(new Event('mihrab:interface-language-changed'));
        }
      } catch (error) {
        await apply(previous).catch(console.error);
        console.error(error);
      } finally {
        select.value = language;
        select.disabled = false;
      }
    });
  }

  api?.onSyncApplied?.(({interfaceLanguage:code}) => {
    if(!code||code===language)return;
    apply(code).then(applied=>{
      if(!applied)return;
      const select=document.getElementById('mihrab-interface-language');
      if(select)select.value=language;
      window.dispatchEvent(new Event('mihrab:interface-language-changed'));
    }).catch(console.error);
  });

  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) update(node);
      } else update(record.target);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: attributes
  });
  const ready = initialize().catch(console.error);
  window.mihrabLocale = { t, localize, ready, has: key => Object.hasOwn(arabic, key) };
})();

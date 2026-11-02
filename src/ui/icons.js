/* Shared stroke icons for static markup and content refreshed by the renderer. */
(() => {
  const paths = {
    'book':
      '<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z"/><path d="M12 5v15"/>',
    'scroll':
      '<path d="M6 3h12a3 3 0 0 1 3 3v3h-5V6a3 3 0 0 0-6 0v12a3 3 0 0 1-6 0v-3h6M6 3a3 3 0 0 0-3 3v2h7M7 21h11a3 3 0 0 0 3-3v-2h-5"/>',
    'video': '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    'sparkles':
      '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
    'lightbulb': '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"/>',
    'chart': '<path d="M4 3v17h17M8 15v-4m5 4V7m5 8v-6"/>',
    'help':
      '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2m0 3h.01"/>',
    'refresh':
      '<path d="M20 7V3m0 4h-4M4 17v4m0-4h4M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'microphone':
      '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    'target':
      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    'star':
      '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    'check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    'search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    'lock':
      '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    'volume': '<path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    'bell': '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
    'monitor': '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-4 0h8"/>',
    'save':
      '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    'warning': '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
    'hourglass': '<path d="M6 2h12M6 22h12M7 2v5l10 10v5M17 2v5L7 17v5"/>',
    'trash': '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    'close': '<path d="m6 6 12 12M6 18 18 6"/>',
    'external':
      '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    'shield': '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
    'settings':
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'mosque':
      '<path d="M5 21V11h14v10M3 21h18M8 11c0-4 4-5 4-8 0 3 4 4 4 8M10 21v-5a2 2 0 0 1 4 0v5"/>',
    'palette':
      '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 2 2 0 0 1 0-4h5a3 3 0 0 0 3-3c0-4-4-7-9-7Z"/><path d="M7 9h.01M10 6h.01M15 6h.01M6 13h.01"/>',
    'moon': '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
    'sun':
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    'pin':
      '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    'globe':
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    'rocket':
      '<path d="M14 5c4-3 7-2 7-2s1 3-2 7l-8 8-5-5 8-8ZM6 13l-3 1 1-6 5-1m2 11-1 3 6-1 1-5M4 20l3-3"/><circle cx="16" cy="8" r="1"/>',
    'clipboard':
      '<rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6m-6 4h6m-6 4h4"/>',
    'signal': '<path d="M4 20h.01M4 12a8 8 0 0 1 8 8M4 4a16 16 0 0 1 16 16"/>',
    'forward': '<path d="m4 5 8 7-8 7V5Zm9 0 8 7-8 7V5Z"/>',
    'reset': '<path d="M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5"/>',
    'flask':
      '<path d="M9 3h6m-5 0v6l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 9V3M7 15h10"/><path d="M9 18h.01m5-1h.01"/>',
  };
  const symbols = {
    '🕌': 'mosque',
    '🕰': 'clock',
    '📜': 'scroll',
    '🎬': 'video',
    '📖': 'book',
    '📘': 'book',
    '⚙': 'settings',
    '🎨': 'palette',
    '🌙': 'moon',
    '☀': 'sun',
    '✨': 'sparkles',
    '💡': 'lightbulb',
    '📊': 'chart',
    '❓': 'help',
    '🔄': 'refresh',
    '➕': 'plus',
    '🎙': 'microphone',
    '🎯': 'target',
    '🌟': 'star',
    '✅': 'check',
    '🔍': 'search',
    '🔒': 'lock',
    '🔊': 'volume',
    '🔔': 'bell',
    '🖥': 'monitor',
    '💾': 'save',
    '⚠': 'warning',
    '⏳': 'hourglass',
    '🗑': 'trash',
    '✖': 'close',
    '↗': 'external',
    '❌': 'close',
    '⏱': 'clock',
    'ℹ': 'info',
    '🛡': 'shield',
    '📗': 'book',
    '📋': 'clipboard',
    '📍': 'pin',
    '🌍': 'globe',
    '🚀': 'rocket',
    '📡': 'signal',
    '⏩': 'forward',
    '⏭': 'forward',
    '↩': 'reset',
    '🧪': 'flask',
  };
  const pattern = new RegExp('(?:' + Object.keys(symbols).join('|') + ')\\uFE0F?', 'gu');
  const excluded = 'svg, script, style, option, textarea';

  function createIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
      class: 'ui-icon',
      'data-icon': name,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': name === 'settings' ? '1.8' : '1.75',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    }))
      svg.setAttribute(key, value);
    svg.innerHTML = paths[name];
    return svg;
  }

  function injectText(node) {
    if (!node.parentElement || node.parentElement.closest(excluded)) return;
    const text = node.nodeValue;
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let start = 0;
    for (const match of matches) {
      fragment.append(
        document.createTextNode(text.slice(start, match.index)),
        createIcon(symbols[match[0].replace(/\uFE0F/g, '')]),
      );
      start = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(start)));
    node.replaceWith(fragment);
  }

  function inject(root) {
    if (root.nodeType === Node.TEXT_NODE) return injectText(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(excluded)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(injectText);
  }

  // Change text nodes only. Never assign display/visibility to a host element.
  inject(document.body);
  new MutationObserver((records) => {
    const added = new Set();
    for (const record of records) {
      if (record.type === 'characterData') added.add(record.target);
      else record.addedNodes.forEach((node) => added.add(node));
    }
    added.forEach(inject);
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
})();

const fs = require('fs'),
  path = require('path');
const PRIVATE_FILE = 'personal-data.json';
function safeUrl(value, kind) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let raw = value.trim().replace(/^https?\/\//i, 'https://');
  if (kind === 'gmail') {
    const email = raw.replace(/^mailto:/i, '');
    return /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? 'mailto:' + email : null;
  }
  const hosts = {
    gitHub: ['github.com', 'www.github.com'],
    instagram: ['instagram.com', 'www.instagram.com'],
    paypal: ['paypal.me', 'www.paypal.me'],
  };
  // Accept a full URL, a domain without a scheme, or a plain account handle.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (/^(?:www\.)?(?:github\.com|instagram\.com|paypal\.me)\//i.test(raw)) raw = 'https://' + raw;
    else if (/^@?[a-zA-Z0-9_.-]+$/.test(raw)) {
      const domain = { gitHub: 'github.com', instagram: 'instagram.com', paypal: 'paypal.me' }[
        kind
      ];
      if (!domain) return null;
      raw = 'https://' + domain + '/' + raw.replace(/^@/, '');
    } else return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts[kind]?.includes(url.hostname.toLowerCase())
  )
    return null;
  if (!url.pathname || url.pathname === '/') return null;
  return url.href;
}
function sanitize(source) {
  const values = source && typeof source === 'object' ? source : {};
  return Object.fromEntries(
    ['gitHub', 'instagram', 'gmail', 'paypal'].map((kind) => {
      const key = Object.keys(values).find((key) => key.toLowerCase() === kind.toLowerCase());
      return [kind, safeUrl(values[key], kind)];
    }),
  );
}
function sanitizeBank(source) {
  return Object.fromEntries(
    ['full_name', 'rib', 'swift_code'].map((key) => [
      key,
      typeof source?.[key] === 'string' ? source[key].trim().slice(0, 250) : '',
    ]),
  );
}
class ProjectInfoEngine {
  constructor(baseDir, writableDir = baseDir, packaged = false) {
    Object.assign(this, { baseDir, writableDir, packaged });
  }
  readSource() {
    const files = this.packaged
      ? [path.join(this.baseDir, 'data', 'personal-data.json')]
      : [
          path.join(this.writableDir, 'data', PRIVATE_FILE),
          path.join(this.baseDir, 'data', PRIVATE_FILE),
          path.join(this.baseDir, 'data', 'personal-data.json'),
        ];
    const file = files.find((f) => fs.existsSync(f));
    if (!file) return null;
    let source;
    try {
      source = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw Error('تعذر قراءة إعدادات دعم المشروع. يرجى مراجعة تنسيقها محلياً.');
    }
    return source;
  }
  publicInfo() {
    const source = this.readSource();
    return { contacts: {paypal:sanitize(source).paypal}, configured: !!source };
  }
  bankInfo() {
    return { bank: sanitizeBank(this.readSource()?.bank_account_informations) };
  }

  bankField(key) {
    if (!['full_name', 'rib', 'swift_code'].includes(key)) throw Error('حقل حساب غير مسموح.');
    const value = sanitizeBank(this.readSource()?.bank_account_informations)[key];
    if (!value) throw Error('هذه المعلومة غير متوفرة حالياً.');
    return value;
  }
  contactUrl(kind) {
    if (kind !== 'paypal')
      throw Error('نوع رابط غير مسموح.');
    const url = this.publicInfo().contacts[kind];
    if (!url) throw Error('هذا الحساب غير مهيأ برابط صالح حالياً.');
    return kind === 'gmail'
      ? 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(url.slice(7))
      : url;
  }
}
module.exports = { ProjectInfoEngine, sanitize, sanitizeBank, safeUrl, PRIVATE_FILE };

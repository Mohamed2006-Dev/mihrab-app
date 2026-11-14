const DEFAULT_ISSUES = 'https://github.com/Mohamed2006-Dev/mihrab-app/issues';
const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSdaBg_HnhuzQAMz-E_PLfp2Io2efGXx6LbB60tcystxRpr9Ow/viewform';
const { reportSections } = require('../ui/report-taxonomy');
function issueBase(value = DEFAULT_ISSUES) {
  const url = new URL(value);
  if (url.origin !== 'https://github.com' || url.username || url.password ||
      !/^\/[^/]+\/[^/]+\/issues(?:\/new)?\/?$/.test(url.pathname)) throw Error('Invalid GitHub Issues URL');
  return url.origin + url.pathname.replace(/\/$/, '').replace(/\/new$/, '');
}

function buildReport({ channel, type, section, description, note, includeContext }, issues, context) {
  if (!['github', 'google'].includes(channel) || !Object.hasOwn(reportSections, type) ||
      !reportSections[type].includes(section) || typeof description !== 'string' ||
      !description.trim() || description.length > 8000 ||
      typeof note !== 'string' || note.length > 300) throw Error('Invalid feedback');
  const technical = includeContext === true && context
    ? Object.entries(context).filter(([, value]) => value).map(([key, value]) => key + ': ' + value).join('\n')
    : '';
  const title = '[Mihrab] ' + type + ' — ' + section;
  const body = ['Report Type: ' + type, 'Affected Section: ' + section,
    'Report Details:\n' + description, technical && 'Technical Context:\n' + technical,
    note.trim() && 'Additional Note:\n' + note].filter(Boolean).join('\n\n');
  const url = new URL(channel === 'github' ? issueBase(issues) + '/new' : FORM);
  if (channel === 'github') {
    url.search = new URLSearchParams({ title, labels: type + ',' + section, body });
  } else {
    const fields = new URLSearchParams({ usp: 'pp_url', 'entry.1660817971': type,
      'entry.1255775619': section, 'entry.2019314870': description });
    if (technical) fields.set('entry.1786272504', technical);
    if (note.trim()) fields.set('entry.639829357', note);
    url.search = fields;
  }
  return { url: url.href, text: title + '\n\n' + body };
}
module.exports = { buildReport };

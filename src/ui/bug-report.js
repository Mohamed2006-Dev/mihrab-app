function initializeBugReport() {
  const get = name => document.getElementById('bug-report-' + name);
  const locale = window.mihrabLocale;
  const form = get('form');
  const type = get('type'), section = get('section'), description = get('description');
  const note = get('note'), status = get('status'), submit = get('continue');
  let opening = false;

  function options(select, values, prefix, selected) {
    select.replaceChildren(...values.map(value => new Option(locale.t(prefix + value), value)));
    if (values.includes(selected)) select.value = selected;
    if (typeof customSelects !== 'undefined') customSelects.get(select)?.sync();
  }
  function updatePrompt() {
    description.placeholder = locale.t('feedback.prompt.' + section.value);
  }
  function updateSections(selected) {
    options(section, reportSections[type.value], 'feedback.section.', selected);
    updatePrompt();
  }
  function updateForm() {
    get('count').textContent = note.value.length + '/300';
    const warning = form.elements.channel.value === 'github' ? 'feedback.githubWarning' : 'feedback.formsWarning';
    get('platform-warning').textContent = locale.t(warning);
    status.textContent = '';
  }
  function localize() {
    if (!locale.has('feedback.type.Bug')) return;
    const selected = section.value;
    options(type, Object.keys(reportSections), 'feedback.type.', type.value);
    updateSections(selected);
    updateForm();
    submit.disabled = opening;
  }
  locale.ready.then(localize);
  window.addEventListener('mihrab:interface-language-changed', localize);
  type.addEventListener('change', () => updateSections());
  section.addEventListener('change', updatePrompt);
  form.addEventListener('input', updateForm);
  form.addEventListener('change', updateForm);
  description.addEventListener('input', () => description.setCustomValidity(''));
  get('clear').addEventListener('click', () => {
    form.reset();
    type.value = 'Bug';
    description.setCustomValidity('');
    localize();
    updateSections();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || opening) return;
    description.setCustomValidity(description.value.trim() ? '' : locale.t('feedback.detailsRequired'));
    if (!form.reportValidity()) return;
    opening = submit.disabled = true;
    try {
      const result = await window.mihrabApi.openBugReport({
        type: type.value, section: section.value, description: description.value, note: note.value,
        channel: form.elements.channel.value, includeContext: get('context').checked,
        language: document.documentElement.lang,
      });
      if (!result?.opened) throw Error('Feedback destination did not open');
      status.textContent = locale.t('feedback.opened');
    } catch { status.textContent = locale.t('feedback.failed'); }
    finally { opening = submit.disabled = false; }
  });
}

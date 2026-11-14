function bindCustomReminders() {
  const form = document.getElementById('custom-reminder-form');
  const editDialog = document.getElementById('custom-reminder-edit');
  const deleteDialog = document.getElementById('custom-reminder-delete');
  const history = document.getElementById('custom-reminder-history');
  const filter = document.getElementById('custom-reminder-filter');
  const latest = document.getElementById('custom-reminder-list');
  const archive = document.getElementById('custom-reminder-archive');
  const status = document.getElementById('custom-reminder-status');
  const editStatus = document.getElementById('custom-reminder-edit-status');
  const deleteStatus = document.getElementById('custom-reminder-delete-status');
  const editForm = form.cloneNode(true);
  editForm.id = 'custom-reminder-edit-form';
  editForm.querySelector('[type=submit]').textContent = 'حفظ التعديلات';
  editDialog.querySelector('h3').after(editForm);
  const rows = () => state.config?.notifications?.customReminders || [];
  const signature = row => JSON.stringify([row.type, row.mode, row.mode === 'interval'
    ? row.hours : row.mode === 'fixed' ? row.clock : [row.prayer, row.offset]]);
  let editing = null;
  let deleting = null;
  let busy = false;

  function sync(target) {
    const fields = target.elements;
    const interval = fields.frequency.value === 'interval';
    const prayer = !interval && fields.timing.value === 'prayer';
    for (const [name, visible] of Object.entries({
      hours: interval, timing: !interval, clock: !interval && !prayer, prayer, offset: prayer,
    })) {
      target.querySelector('[data-reminder-field="' + name + '"]').hidden = !visible;
      fields[name].disabled = !visible;
      fields[name].required = visible;
    }
  }

  function button(label, className, handler) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'btn ' + className;
    control.textContent = label;
    control.addEventListener('click', handler);
    return control;
  }

  function createRow(row) {
    const item = document.createElement('div');
    item.className = 'custom-reminder-row';
    const label = document.createElement('span');
    const kind = [...form.elements.kind.options].find(option => option.value === row.type)?.textContent;
    const prayer = [...form.elements.prayer.options].find(option => option.value === row.prayer)?.textContent;
    const timing = row.mode === 'interval' ? 'كل ' + row.hours + ' ساعة' :
      row.mode === 'fixed' ? 'يومياً عند ' + row.clock :
        'يومياً بعد ' + prayer + ' بـ' + row.offset + ' دقيقة';
    label.textContent = kind + ' · ' + timing;
    const actions = document.createElement('div');
    actions.className = 'custom-reminder-actions';
    actions.append(button('تعديل', 'btn-primary', () => {
      editing = row;
      const fields = editForm.elements;
      fields.kind.value = row.type;
      fields.frequency.value = row.mode === 'interval' ? 'interval' : 'daily';
      fields.timing.value = row.mode === 'prayer' ? 'prayer' : 'fixed';
      fields.hours.value = row.hours ?? 2;
      fields.clock.value = row.clock || '08:00';
      fields.prayer.value = row.prayer || 'fajr';
      fields.offset.value = row.offset ?? 15;
      if (fields.durationSeconds) fields.durationSeconds.value = row.durationSeconds ?? 15;
      sync(editForm);
      editStatus.textContent = '';
      editDialog.showModal();
    }), button('حذف', 'btn-danger', () => {
      deleting = row.id;
      deleteStatus.textContent = '';
      deleteDialog.showModal();
    }));
    item.append(label, actions);
    return item;
  }

  function render() {
    const current = rows();
    latest.replaceChildren();
    if (current.length) latest.append(createRow(current.at(-1)));
    const matching = current.filter(row => !filter.value || row.type === filter.value).reverse();
    archive.replaceChildren(...matching.map(createRow));
    if (!matching.length) archive.textContent = 'لا توجد تذكيرات مطابقة.';
  }

  async function save(next, feedback) {
    if (busy) return false;
    busy = true;
    try {
      const result = await window.mihrabApi.saveCustomReminders(next);
      state.config = { ...state.config, notifications: { ...state.config?.notifications, customReminders: result } };
      render();
      return true;
    } catch (error) {
      feedback.textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      return false;
    } finally {
      busy = false;
    }
  }

  for (const target of [form, editForm]) {
    target.addEventListener('change', () => sync(target));
    target.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const old = target === editForm ? editing : null;
      const feedback = old ? editStatus : status;
      feedback.textContent = '';
      const fields = target.elements;
      const mode = fields.frequency.value === 'interval' ? 'interval' : fields.timing.value;
      const row = {
        id: old?.id || crypto.randomUUID(), type: fields.kind.value, mode, start: Date.now(),
        durationSeconds: fields.durationSeconds ? fields.durationSeconds.valueAsNumber : old?.durationSeconds,
        ...(mode === 'interval' ? { hours: fields.hours.valueAsNumber } :
          mode === 'fixed' ? { clock: fields.clock.value } :
            { prayer: fields.prayer.value, offset: fields.offset.valueAsNumber }),
      };
      if (old && signature(old) === signature(row) && (old.durationSeconds ?? 15) === (row.durationSeconds ?? 15)) {
        editDialog.close();
        return;
      }
      if (rows().some(item => item.id !== row.id && signature(item) === signature(row))) {
        if (old) feedback.textContent = 'يوجد تذكير بهذه الإعدادات.';
        return;
      }
      const next = old ? rows().map(item => item.id === old.id ? row : item) : [...rows(), row];
      if (await save(next, feedback)) {
        if (old) editDialog.close();
        else showSuccessFeedback('حُفظ التذكير.');
      }
    });
    sync(target);
  }

  document.getElementById('custom-reminder-open-history').addEventListener('click', () => {
    render();
    history.showModal();
  });
  document.getElementById('custom-reminder-confirm-delete').addEventListener('click', async () => {
    if (deleting && await save(rows().filter(row => row.id !== deleting), deleteStatus)) deleteDialog.close();
  });
  filter.addEventListener('change', render);
  window.addEventListener('mihrab-sync-applied', render);
  document.getElementById('data-notice-section-custom').addEventListener('click', render);
  render();
}

function showUpdateHighlights() {
  const dialog = document.getElementById('update-highlights');
  const key = 'mihrab.seen-updates.1.0.3';
  if (localStorage.getItem(key) || document.querySelector('dialog[open]')) return;
  dialog.addEventListener('close', () => localStorage.setItem(key, '1'), { once: true });
  dialog.showModal();
}

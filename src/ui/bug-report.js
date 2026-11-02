function initializeBugReport() {
  const form = document.getElementById('bug-report-form'),
    status = document.getElementById('bug-report-status'),
    output = document.getElementById('bug-report-preview');
  let pendingReport = null;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    output.value = [
      'نطاق الخطأ: ' + document.getElementById('bug-report-scope').value.trim(),
      '',
      'وصف الخطأ:',
      document.getElementById('bug-report-description').value.trim(),
      '',
      'الوجهة المختارة: ' + (form.elements.channel.value === 'github' ? 'GitHub' : 'Gmail'),
    ].join('\n');
    output.hidden = false;
    document.getElementById('bug-report-copy').disabled = false;
    pendingReport = {
      channel: form.elements.channel.value,
      scope: document.getElementById('bug-report-scope').value.trim(),
      description: document.getElementById('bug-report-description').value.trim(),
    };
    document.getElementById('bug-report-continue').disabled = false;
    status.textContent = 'راجع المعاينة ثم تابع إلى المنصة لإتمام الإرسال بنفسك. لم يُرسل شيء بعد.';
  });
  document.getElementById('bug-report-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      briefInlineFeedback(status, 'نُسخ نص البلاغ.');
    } catch {
      status.textContent = 'تعذر النسخ تلقائياً. يمكنك تحديد النص ونسخه يدوياً.';
    }
  });
  form.addEventListener('input', (event) => {
    if (event.target === output) return;
    output.hidden = true;
    pendingReport = null;
    document.getElementById('bug-report-continue').disabled = true;
    document.getElementById('bug-report-copy').disabled = true;
  });
  document.getElementById('bug-report-clear').addEventListener('click', () => {
    form.reset();
    output.value = '';
    output.hidden = true;
    pendingReport = null;
    document.getElementById('bug-report-continue').disabled = true;
    document.getElementById('bug-report-copy').disabled = true;
    status.textContent = 'أُفرغت مسودة البلاغ المحلية.';
  });
  const dialog = document.getElementById('bug-report-privacy-dialog'),
    consent = document.getElementById('bug-report-consent'),
    confirm = document.getElementById('bug-report-confirm');
  document.getElementById('bug-report-continue').addEventListener('click', () => {
    if (!pendingReport) return;
    consent.checked = false;
    confirm.disabled = true;
    document.getElementById('bug-report-redirect-error').textContent = '';
    document.getElementById('bug-report-platform-warning').textContent =
      pendingReport.channel === 'github'
        ? 'GitHub: البلاغ سيكون علنياً في المستودع العام، ويظهر اسم حساب GitHub الذي تنشر منه. لا يستطيع محراب إخفاء المؤلف في هذا المسار. يمكنك اختيار Gmail إذا كنت لا تريد نشر البلاغ للعامة.'
        : 'Gmail: ستُجهز رسالة إلى anonymous.acc.unkown@gmail.com حصراً. عند إرسالها سيظهر اسمك وبريد الحساب الذي تختاره للمستلم، وتخضع الرسالة لسياسة Google.';
    dialog.showModal();
  });
  consent.addEventListener('change', () => {
    confirm.disabled = !consent.checked;
  });
  document.getElementById('bug-report-cancel').addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', async () => {
    if (!consent.checked || !pendingReport) return;
    confirm.disabled = true;
    try {
      const result = await window.mihrabApi.openBugReport(pendingReport);
      dialog.close();
      status.textContent = result.copyRequired
        ? 'فُتحت الخدمة ونُسخ النص الكامل إلى الحافظة. الصقه ثم أرسل البلاغ بنفسك.'
        : 'فُتحت مسودة البلاغ. راجعها ثم أكد الإرسال في الخدمة المختارة. لم يؤكد محراب إرسالها.';
    } catch (error) {
      document.getElementById('bug-report-redirect-error').textContent = error.message;
    } finally {
      confirm.disabled = !consent.checked;
    }
  });
}

'use strict';

const lessonChannelDirectory = [
  {
    "name": "فضيلة الشيخ ابن باز Alsheikh Binbaz",
    "input": "UCXI4M81wRAVYlFPw7V1l3Mw",
    "category": "فقه وفتاوى",
    "avatar": "UCXI4M81wRAVYlFPw7V1l3Mw.jpg"
  },
  {
    "name": "قناة الشيخ محمد ابن عثيمين الرسمية",
    "input": "UCtF3YygTiodnYSw8vD3UJtQ",
    "category": "فقه وحديث",
    "avatar": "UCtF3YygTiodnYSw8vD3UJtQ.jpg"
  },
  {
    "name": "Dr. Othman Alkamees - الشيخ الدكتور عثمان الخميس",
    "input": "UCWjCSGhmSGu0VLf2mPFS0Kg",
    "category": "فقه وفتاوى",
    "avatar": "UCWjCSGhmSGu0VLf2mPFS0Kg.jpg"
  },
  {
    "name": "عبدالمحسن بن حمد العباد",
    "input": "UC6UwNU4kNwbozS9JzDWZtpw",
    "category": "حديث وشروحه",
    "avatar": "UC6UwNU4kNwbozS9JzDWZtpw.jpg"
  },
  {
    "name": "الشيخ سليمان الرحيلي",
    "input": "UCvDo7DynSXU4XbaNPh1Jylg",
    "category": "فقه وحديث",
    "avatar": "UCvDo7DynSXU4XbaNPh1Jylg.jpg"
  },
  {
    "name": "مسائل دينية",
    "input": "UCBT9cP7s81PaZHF4qXiXi_g",
    "category": "فقه وفتاوى",
    "avatar": "UCBT9cP7s81PaZHF4qXiXi_g.jpg"
  },
  {
    "name": "قناة الشَّيخ سَعيد الكَمَلي",
    "input": "UCASAOTD6fMPEg8jmO4nPblQ",
    "category": "فقه وحديث",
    "avatar": "UCASAOTD6fMPEg8jmO4nPblQ.jpg"
  },
  {
    "name": "د. أحمد العربي",
    "input": "UCF3kYy_SVFZVj5-YbFriKpQ",
    "category": "تزكية وتربية",
    "avatar": "UCF3kYy_SVFZVj5-YbFriKpQ.jpg"
  },
  {
    "name": "مشاري راشد العفاسي",
    "input": "UCmMcOjsVehVlEOteyrhjI2Q",
    "category": "تلاوات قرآنية",
    "avatar": "UCmMcOjsVehVlEOteyrhjI2Q.jpg"
  },
  {
    "name": "Ahmad alnufais | أحمد النفيس",
    "input": "UCTY0UNILf_OBsWF2WEv0mLQ",
    "category": "تلاوات قرآنية",
    "avatar": "UCTY0UNILf_OBsWF2WEv0mLQ.jpg"
  },
  {
    "name": "يقين لنقد الإلحاد واللادينية",
    "input": "UCIjZ6dACy1oG9IBxqbvU7hw",
    "category": "الإيمان ومناقشة الشبهات",
    "avatar": "UCIjZ6dACy1oG9IBxqbvU7hw.jpg"
  },
  {
    "name": "الدكتور إياد قنيبي - القناة الرسمية",
    "input": "UCahYlNszeMy_PHffYvgAOHg",
    "category": "الإيمان ومناقشة الشبهات",
    "avatar": "UCahYlNszeMy_PHffYvgAOHg.jpg"
  }
];
const bundledChannelAvatars = new Map(lessonChannelDirectory.map(({ input, avatar }) => [
  input, './assets/channel-avatars/' + avatar,
]));
const channelArchiveKey = 'mihrab.removed-channels';

function readChannelArchive() {
  try {
    const rows = JSON.parse(localStorage.getItem(channelArchiveKey) || '[]');
    return Array.isArray(rows) ? rows.filter(row => row && /^[\w-]{24}$/.test(row.input)) : [];
  } catch {
    return [];
  }
}

function rememberRemovedChannel(channel) {
  const archive = readChannelArchive().filter(row => row.input !== channel.channelId);
  archive.unshift({ input: channel.channelId, name: channel.name, category: channel.category || 'أضفتها سابقاً' });
  localStorage.setItem(channelArchiveKey, JSON.stringify(archive));
}

function lessonContextCounts(feed, channels) {
  const counts = new Map();
  for (const row of feed.contextCounts || []) {
    if (channels.size && !channels.has(row.channelId)) continue;
    counts.set(row.contextId, (counts.get(row.contextId) || 0) + row.count);
  }
  return counts;
}

function bindLessonExtras() {
  const dialog = document.getElementById('channel-directory');
  const query = document.getElementById('channel-directory-query');
  const category = document.getElementById('channel-directory-category');
  const status = document.getElementById('channel-directory-status');
  const categories = [...new Set(lessonChannelDirectory.map(row => row.category))];
  for (const title of categories) category.add(new Option(title, title));
  let busy = false;
  const fold = (value) => value.normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase();


  function render() {
    const followed = new Set((state.youtubeState?.channels || []).map(row => row.channelId));
    const removed = readChannelArchive().filter(row => !followed.has(row.input));
    for (const [id, rows] of [['removed', removed], ['suggested', lessonChannelDirectory.filter(row => !followed.has(row.input))]]) {
      const host = document.getElementById('channel-directory-' + id);
      host.replaceChildren();
      for (const entry of rows) {
        const haystack = fold(entry.name + ' ' + entry.category + ' ' + entry.input);
        if (!fold(query.value.trim()).split(/\s+/).every(term => haystack.includes(term))) continue;
        if (id === 'suggested' && category.value && category.value !== entry.category) continue;
        const row = document.createElement('div');
        row.className = 'directory-row';
        const label = document.createElement('strong');
        label.setAttribute('data-no-ui-translation', '');
        label.dir = 'auto';
        label.textContent = entry.name;
        const add = document.createElement('button');
        add.className = 'btn btn-secondary';
        add.type = 'button';
        add.textContent = id === 'removed' ? 'استعادة' : 'إضافة';
        add.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          add.disabled = true;
          status.textContent = 'جارٍ إضافة القناة…';
          try {
            const result = await window.mihrabApi.addYoutubeChannel({ channelId: entry.input, category: entry.category });
            if (!result.channel) throw new Error('تعذرت إضافة القناة.');
            renderYoutubeState(result.feeds);
            status.textContent = 'القناة ضمن متابعاتك.';
            render();
          } catch (error) {
            status.textContent = String(error.message).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
          } finally {
            busy = false;
            if (add.isConnected) add.disabled = false;
          }
        });
        const info = document.createElement('div');
        info.className = 'directory-channel';
        const fallback = document.createElement('span');
        fallback.className = 'directory-avatar';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = '▶';
        const source = bundledChannelAvatars.get(entry.input);
        if (source) {
          const avatar = document.createElement('img');
          avatar.className = 'directory-avatar';
          avatar.alt = '';
          avatar.loading = 'lazy';
          avatar.addEventListener('error', () => avatar.replaceWith(fallback), { once: true });
          avatar.src = source;
          info.append(avatar);
        } else {
          info.append(fallback);
        }
        const copy = document.createElement('div');
        copy.className = 'directory-channel-copy';
        const specialty = document.createElement('small');
        specialty.textContent = entry.category;
        copy.append(label, specialty);
        info.append(copy);
        row.append(info, add);
        host.append(row);
      }
      if (!host.children.length) host.textContent = id === 'removed' ? 'لا توجد قنوات محذوفة مطابقة.' : 'لا توجد قنوات مطابقة.';
    }
  }
  document.getElementById('btn-channel-directory').addEventListener('click', () => {
    status.textContent = '';
    render();
    dialog.showModal();
  });
  query.addEventListener('input', render);
  category.addEventListener('change', render);
}

let currentLesson = null;
let lessonHistory = new Set();
let lessonDialogGeneration = 0;

async function openLessonCard(target) {
  const dialog = document.getElementById('lesson-reminder-dialog');
  const generation = ++lessonDialogGeneration;
  lessonHistory = new Set();
  if (!dialog.open) dialog.showModal();
  showLesson(null, 'جارٍ تحميل الدرس…');
  try {
    const video = target.videoId
      ? await window.mihrabApi.getLessonById(target.videoId)
      : (await window.mihrabApi.getYoutubeState()).dailyRecommendation;
    if (generation !== lessonDialogGeneration || !dialog.open) return;
    showLesson(video, 'الدرس غير متاح ضمن القنوات المتابَعة.');
  } catch (error) {
    console.warn('Lesson card:', error);
    if (generation === lessonDialogGeneration && dialog.open) showLesson(null, 'تعذر فتح الدرس.');
  }
}

function showLesson(video, message = '') {
  currentLesson = video && /^[\w-]{11}$/.test(video.videoId) ? video : null;
  const image = document.getElementById('lesson-reminder-image');
  const network = state.config?.network;
  image.removeAttribute('src');
  image.hidden = !currentLesson || network?.enabled === false || network?.categories?.youtube === false;
  document.getElementById('lesson-reminder-title').textContent = currentLesson?.title || message;
  document.getElementById('lesson-reminder-channel').textContent = currentLesson?.channelName || '';
  document.getElementById('lesson-reminder-status').textContent = '';
  for (const id of ['watch', 'another', 'snooze']) {
    document.getElementById('lesson-reminder-' + id).disabled = !currentLesson;
  }
  if (currentLesson) {
    lessonHistory.add(currentLesson.videoId);
    if (!image.hidden) image.src = 'https://i.ytimg.com/vi/' + currentLesson.videoId + '/hqdefault.jpg';
  }
}

function bindLessonCard() {
  const dialog = document.getElementById('lesson-reminder-dialog');
  const status = document.getElementById('lesson-reminder-status');
  dialog.addEventListener('close', () => { ++lessonDialogGeneration; });
  document.getElementById('lesson-reminder-image').addEventListener('error', event => { event.currentTarget.hidden = true; });
  const actions = {
    watch: async video => window.mihrabApi.openExternalUrl('https://www.youtube.com/watch?v=' + video.videoId),
    another: async () => {
      const video = await window.mihrabApi.getAnotherLesson([...lessonHistory]);
      if (video) showLesson(video);
      else status.textContent = 'لا توجد مقاطع أخرى متاحة حالياً.';
    },
    snooze: async video => {
      await window.mihrabApi.snoozeLesson(video.videoId);
      dialog.close();
    },
  };
  for (const [id, action] of Object.entries(actions)) {
    const button = document.getElementById('lesson-reminder-' + id);
    button.addEventListener('click', async () => {
      if (!currentLesson) return;
      button.disabled = true;
      try { await action(currentLesson); }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = !currentLesson; }
    });
  }
}

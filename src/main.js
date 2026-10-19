import library from './data/library.json';
import {
  DRAFT_KEY,
  normalizeLibrary,
  newDraft,
  filterLibrary,
  loadDraft,
  saveDraft,
  validateDraft,
  buildReport,
} from './core.js';
import './styles.css';

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const records = normalizeLibrary(library);
const byId = new Map(records.map((r) => [r.id, r]));
let draft = newDraft(library.sha256);
let storageBlocked = false;
let report = null;
let noticeTimer;

function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  if ($('report-dialog').open) $('report-status').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      $('notice').hidden = true;
    },
    error ? 12000 : 4500,
  );
}

try {
  const restored = loadDraft(window.localStorage, records, library.sha256);
  if (restored) {
    draft = restored;
    $('draft-status').textContent = '已恢复本机草稿';
  }
} catch (error) {
  storageBlocked = true;
  $('draft-status').textContent = '原草稿无法恢复，自动保存已暂停';
  notify(`${error.message} 可先“备份草稿”，再“新建督导”。`, true);
}

function persist(explicit = false) {
  if (storageBlocked) {
    if (explicit) notify('自动保存已暂停。请先备份原草稿，再新建督导；也可备份当前记录。', true);
    return;
  }
  try {
    draft = saveDraft(window.localStorage, draft, records, library.sha256);
    $('draft-status').textContent =
      `已保存本机 · ${new Date(draft.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (explicit) notify('草稿已保存到当前浏览器。');
  } catch (error) {
    $('draft-status').textContent = '保存失败，请备份草稿';
    notify(`草稿未保存：${error.message}。请使用“备份草稿”下载当前记录。`, true);
  }
}

function syncMetadata() {
  ['location', 'date', 'description'].forEach((id) => {
    $(id).value = draft[id];
  });
}
function visibleRecords() {
  return filterLibrary(records, {
    keyword: $('keyword').value,
    domain: $('domain').value,
    categoryId: $('category').value,
  });
}
function renderLibrary() {
  const focusedId = document.activeElement?.dataset.id;
  const shown = visibleRecords();
  const selected = new Set(draft.observations.map((o) => o.problemId));
  $('result-count').textContent = `${shown.length} / ${records.length}`;
  $('select-visible').disabled = shown.length === 0;
  $('problem-list').innerHTML = shown.length
    ? shown
        .map(
          (r) => `
    <div class="problem-card ${selected.has(r.id) ? 'selected' : ''}">
      <label class="problem-choice"><input type="checkbox" data-id="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="选择 ${r.id} ${escape(r.problem)}" /><span><span class="problem-meta"><b>${r.id}</b><span>${escape(r.domain)}</span></span><strong>${escape(r.problem)}</strong></span></label>
      <div class="problem-content"><span class="category-tag">${r.categoryId} · ${escape(r.category)}</span><details><summary>查看后果、建议与来源</summary><p><b>可能后果</b>${escape(r.consequence)}</p><p><b>整改建议</b>${escape(r.advice)}</p><details class="raw-details"><summary>全部 17 个源字段</summary><dl>${library.headers.map((h) => `<dt>${escape(h)}</dt><dd>${escape(r.raw[h])}</dd>`).join('')}</dl></details></details></div>
    </div>`,
        )
        .join('')
    : '<div class="empty-state"><span aria-hidden="true">⌕</span><h3>没有匹配的问题</h3><p>请尝试其他关键词，或重置筛选条件。</p></div>';
  if (focusedId && byId.has(focusedId)) {
    document
      .querySelector(`#problem-list input[data-id="${focusedId}"]`)
      ?.focus({ preventScroll: true });
  }
}

function renderObservations() {
  $('selected-count').textContent = draft.observations.length;
  $('clear-records').disabled = !draft.observations.length;
  $('observations').innerHTML = draft.observations.length
    ? draft.observations
        .map((o, index) => {
          const r = byId.get(o.problemId);
          return `<section class="observation" data-key="${escape(o.key)}"><div class="observation-heading"><span class="count-pill">${index + 1}</span><b>${r.id}</b><button type="button" data-action="remove" class="text-button danger" aria-label="移除记录 ${index + 1}">移除</button></div><h3>${escape(r.problem)}</h3><label>具体点位 <span class="required">*</span><input data-field="point" value="${escape(o.point)}" placeholder="例如：1 栋天台、宿舍 302 室" required /></label><label>现场补充描述 <span class="optional">选填</span><textarea data-field="description" rows="2" placeholder="补充数量、位置、现场状态等实际发现">${escape(o.description)}</textarea></label><details class="advice-preview"><summary>对应整改建议</summary><p>${escape(r.advice)}</p></details><button type="button" data-action="duplicate" class="text-button add-point">＋ 同一问题增加点位</button></section>`;
        })
        .join('')
    : '<div class="empty-state"><span class="empty-icon" aria-hidden="true">▤</span><h3>开始记录现场发现</h3><p>从问题库勾选问题，<br />在这里填写具体点位与现场描述。</p></div>';
}
function addObservation(problemId) {
  draft.observations.push({ key: crypto.randomUUID(), problemId, point: '', description: '' });
}
function renderAll() {
  syncMetadata();
  renderLibrary();
  renderObservations();
}

['location', 'date', 'description'].forEach((id) =>
  $(id).addEventListener('input', () => {
    draft[id] = $(id).value;
    persist();
  }),
);
['keyword', 'domain', 'category'].forEach((id) =>
  $(id).addEventListener(id === 'keyword' ? 'input' : 'change', renderLibrary),
);
$('reset-filters').addEventListener('click', () => {
  ['keyword', 'domain', 'category'].forEach((id) => {
    $(id).value = '';
  });
  renderLibrary();
});
$('problem-list').addEventListener('change', (event) => {
  const input = event.target.closest('input[data-id]');
  if (!input) return;
  const id = input.dataset.id;
  if (input.checked) addObservation(id);
  else {
    const entries = draft.observations.filter((o) => o.problemId === id);
    if (
      (entries.length > 1 || entries.some((o) => o.point || o.description)) &&
      !confirm(`取消勾选将移除 ${id} 的 ${entries.length} 条现场记录，是否继续？`)
    ) {
      input.checked = true;
      return;
    }
    draft.observations = draft.observations.filter((o) => o.problemId !== id);
  }
  renderLibrary();
  renderObservations();
  persist();
});
$('select-visible').addEventListener('click', () => {
  const selected = new Set(draft.observations.map((o) => o.problemId));
  visibleRecords()
    .filter((r) => !selected.has(r.id))
    .forEach((r) => addObservation(r.id));
  renderLibrary();
  renderObservations();
  persist();
});
$('observations').addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  if (!['point', 'description'].includes(field)) return;
  const key = event.target.closest('[data-key]').dataset.key;
  const entry = draft.observations.find((o) => o.key === key);
  entry[field] = event.target.value;
  persist();
});
$('observations').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const key = button.closest('[data-key]').dataset.key;
  const entry = draft.observations.find((o) => o.key === key);
  if (button.dataset.action === 'duplicate') addObservation(entry.problemId);
  else {
    if ((entry.point || entry.description) && !confirm('是否移除这条现场记录？')) return;
    draft.observations = draft.observations.filter((o) => o.key !== key);
  }
  renderLibrary();
  renderObservations();
  persist();
});
$('clear-records').addEventListener('click', () => {
  if (!confirm('是否清空全部已选问题和现场记录？督导基本信息将保留。')) return;
  draft.observations = [];
  renderLibrary();
  renderObservations();
  persist();
});
$('save-draft').addEventListener('click', () => persist(true));
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('download-draft').addEventListener('click', () => {
  if (storageBlocked && confirm('是否备份无法恢复的原草稿？选“取消”可备份当前正在编辑的记录。')) {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw !== null) {
        download(new Blob([raw], { type: 'application/json' }), '督导草稿_原始备份.json');
        return;
      }
    } catch (error) {
      notify(`无法读取原草稿：${error.message}`, true);
    }
  }
  download(
    new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
    `督导草稿_${draft.date}.json`,
  );
  notify('草稿备份已下载，包含现场记录，请妥善保管。');
});
$('import-draft').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('草稿文件超过 10 MB');
    const incoming = validateDraft(JSON.parse(await file.text()), records, library.sha256);
    if (!confirm('导入将替换当前工作记录及本机草稿，是否继续？建议先备份当前草稿。')) return;
    draft = incoming;
    storageBlocked = false;
    renderAll();
    persist(true);
  } catch (error) {
    notify(`导入失败：${error.message}`, true);
  } finally {
    event.target.value = '';
  }
});
$('new-draft').addEventListener('click', () => {
  if (!confirm('新建督导将删除本机已保存草稿并清空当前全部记录，是否继续？建议先备份。')) return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch (error) {
    notify(`本机草稿未能清除：${error.message}`, true);
    return;
  }
  storageBlocked = false;
  draft = newDraft(library.sha256);
  report = null;
  $('draft-status').textContent = '尚未保存草稿';
  renderAll();
  notify('已新建督导，本机旧草稿已清除。');
});
function preview() {
  try {
    report = buildReport(draft, records, library);
    $('report-content').replaceChildren(
      ...report.blocks.map((block) => {
        const element = document.createElement(
          { title: 'h2', heading: 'h3', subheading: 'h4', body: 'p' }[block.type],
        );
        element.textContent = block.text;
        return element;
      }),
    );
    $('copy-fallback').hidden = true;
    $('report-status').textContent = '请核对点位及现场描述后使用';
    $('report-dialog').showModal();
  } catch (error) {
    notify(error.message, true);
  }
}
$('preview').addEventListener('click', preview);
$('step-preview').addEventListener('click', preview);
$('close-dialog').addEventListener('click', () => $('report-dialog').close());
$('copy-report').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report.text);
    notify('报告文字已复制。');
  } catch {
    $('copy-fallback').hidden = false;
    $('copy-text').value = report.text;
    $('copy-text').focus();
    $('copy-text').select();
    notify('浏览器未允许自动复制，请按 ⌘C / Ctrl+C，或长按复制已选文字。');
  }
});
$('export-word').addEventListener('click', async () => {
  const button = $('export-word');
  button.disabled = true;
  button.textContent = '正在导出…';
  try {
    const { createWordBlob, reportFilename } = await import('./word.js');
    download(await createWordBlob(report), reportFilename(draft));
    notify('Word 报告已导出。');
  } catch (error) {
    notify(`Word 导出失败：${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = '导出 Word';
  }
});

[...new Set(records.map((r) => r.domain))].forEach((domain) =>
  $('domain').add(new Option(domain, domain)),
);
[...new Map(records.map((r) => [r.categoryId, r.category])).entries()]
  .sort()
  .forEach(([id, category]) => $('category').add(new Option(`${id} ${category}`, id)));
$('source-name').textContent = library.source;
$('source-stats').textContent =
  `${new Set(records.map((r) => r.domain)).size} 个工作领域 · ${new Set(records.map((r) => r.categoryId)).size} 个后果类别`;
$('source-hash').textContent = `Excel SHA-256：${library.sha256}`;
renderAll();

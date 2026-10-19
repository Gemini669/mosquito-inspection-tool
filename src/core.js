export const APP_TITLE = '登革热与基孔肯雅热督导问题及整改建议自动生成系统 V1.0';
export const DRAFT_KEY = 'mosquito-inspection:draft:v1';
export const DRAFT_VERSION = 1;

export function normalizeLibrary(data) {
  if (data.recordCount !== data.records.length) throw new Error('问题库数量不一致');
  const records = data.records.map((raw) => ({
    id: raw['问题编号'],
    domain: raw['工作领域（统一）'],
    problem: raw['可能发现的问题'],
    consequence: raw['可能造成的不良后果'],
    categoryId: raw['后果类别编号'],
    category: raw['后果类别名称'],
    advice: raw['疾控中心技术建议'],
    raw,
  }));
  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('问题编号重复');
  return records;
}

export function filterLibrary(records, { keyword = '', domain = '', categoryId = '' } = {}) {
  const words = keyword.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return records.filter(
    (r) =>
      (!domain || r.domain === domain) &&
      (!categoryId || r.categoryId === categoryId) &&
      words.every((word) => Object.values(r.raw).join('\n').toLocaleLowerCase().includes(word)),
  );
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function newDraft(sha256) {
  return {
    version: DRAFT_VERSION,
    librarySha256: sha256,
    location: '',
    date: localDate(),
    description: '',
    observations: [],
    updatedAt: null,
  };
}

function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function validateDraft(draft, records, sha256) {
  if (!draft || draft.version !== DRAFT_VERSION)
    throw new Error('草稿格式或版本不受支持，原草稿未被覆盖。');
  if (draft.librarySha256 !== sha256)
    throw new Error('草稿使用的问题库版本不同，原草稿未被覆盖。请先备份草稿并核对问题库。');
  if (
    !['location', 'date', 'description'].every((k) => typeof draft[k] === 'string') ||
    !Array.isArray(draft.observations) ||
    (draft.date !== '' && !validDate(draft.date)) ||
    !(
      draft.updatedAt === null ||
      (typeof draft.updatedAt === 'string' && !Number.isNaN(Date.parse(draft.updatedAt)))
    )
  ) {
    throw new Error('草稿内容损坏，原草稿未被覆盖。');
  }
  const ids = new Set(records.map((r) => r.id));
  const keys = new Set();
  for (const o of draft.observations) {
    if (
      !o ||
      typeof o.key !== 'string' ||
      !o.key ||
      keys.has(o.key) ||
      !ids.has(o.problemId) ||
      typeof o.point !== 'string' ||
      typeof o.description !== 'string'
    ) {
      throw new Error('草稿含重复记录编号、未知问题或损坏记录，原草稿未被覆盖。');
    }
    keys.add(o.key);
  }
  return draft;
}

export function loadDraft(storage, records, sha256) {
  const content = storage.getItem(DRAFT_KEY);
  if (content === null) return null;
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('草稿不是有效的 JSON，原草稿未被覆盖。');
  }
  return validateDraft(value, records, sha256);
}

export function saveDraft(storage, draft, records, sha256) {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  validateDraft(next, records, sha256);
  storage.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

export function validateReport(draft, records, sha256) {
  validateDraft(draft, records, sha256);
  if (!draft.location.trim()) throw new Error('请填写督导地点。');
  if (!validDate(draft.date)) throw new Error('请填写有效的督导日期。');
  if (!draft.observations.length) throw new Error('请至少选择一个问题并记录点位。');
  const missing = draft.observations.findIndex((o) => !o.point.trim());
  if (missing !== -1) throw new Error(`请填写第 ${missing + 1} 条现场记录的具体点位。`);
}

// Categories only organize text. Only exactly equal consequence strings are deduplicated.
// Every observation retains its own source problem, point, note and independent advice.
export function groupObservations(draft, records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const groups = new Map();
  draft.observations.forEach((observation, index) => {
    const record = byId.get(observation.problemId);
    if (!record) throw new Error(`未知问题编号：${observation.problemId}`);
    if (!groups.has(record.categoryId))
      groups.set(record.categoryId, {
        id: record.categoryId,
        name: record.category,
        consequences: [],
        items: [],
      });
    const group = groups.get(record.categoryId);
    let risk = group.consequences.find((c) => c.text === record.consequence);
    if (!risk) {
      risk = { text: record.consequence, references: [] };
      group.consequences.push(risk);
    }
    const number = index + 1;
    risk.references.push(number);
    group.items.push({
      observation,
      record,
      number,
      riskNumber: group.consequences.indexOf(risk) + 1,
    });
  });
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildReport(draft, records, source) {
  validateReport(draft, records, source.sha256);
  const groups = groupObservations(draft, records);
  const blocks = [
    { type: 'title', text: '登革热与基孔肯雅热督导报告' },
    { type: 'body', text: `督导地点：${draft.location}` },
    { type: 'body', text: `督导日期：${draft.date}` },
    {
      type: 'body',
      text: `现场记录：${draft.observations.length} 条；涉及问题：${new Set(draft.observations.map((o) => o.problemId)).size} 项；后果类别：${groups.length} 类。`,
    },
    { type: 'body', text: `现场总体补充描述：${draft.description || '未填写'}` },
    { type: 'heading', text: '一、发现问题、可能后果及整改建议' },
  ];
  groups.forEach((group, index) => {
    blocks.push({ type: 'heading', text: `${index + 1}. ${group.id} ${group.name}` });
    blocks.push({ type: 'body', text: '可能造成的不良后果（同类归组，原文保留）：' });
    group.consequences.forEach((risk, i) =>
      blocks.push({
        type: 'body',
        text: `后果 ${i + 1}（关联记录 ${risk.references.map((n) => `#${n}`).join('、')}）：${risk.text}`,
      }),
    );
    group.items.forEach(({ observation: o, record: r, number, riskNumber }) => {
      blocks.push({ type: 'subheading', text: `记录 #${number}｜${r.id}｜${r.domain}` });
      const lines = [
        `具体点位：${o.point}`,
        `发现问题：${r.problem}`,
        `现场补充描述：${o.description || '未填写'}`,
        `对应后果：${group.id} · 后果 ${riskNumber}`,
        `整改建议（问题库原文）：${r.advice}`,
        `协作责任方（建议）：${r.raw['协作责任方（建议）']}`,
        `建议复核点：${r.raw['建议复核点']}`,
        `整改时效建议（非强制）：${r.raw['整改时效建议（非强制）']}`,
        `疾病适用：${r.raw['疾病适用']}`,
        `权威依据网址（来源库）：${r.raw['权威依据网址']}`,
        `原始编号与来源：${r.raw['原始编号与来源']}`,
      ];
      lines.forEach((text) => blocks.push({ type: 'body', text }));
    });
  });
  blocks.push(
    { type: 'heading', text: '二、数据来源与归并规则' },
    {
      type: 'body',
      text: `来源：${source.source} / ${source.sheet}，共 ${source.recordCount} 条；SHA-256：${source.sha256}`,
    },
    {
      type: 'body',
      text: '报告按后果类别编号归组，仅完全相同的后果原文去重并列出关联记录；不同后果表述逐条保留。每条现场记录分别列出具体问题、点位和独立整改建议。专业内容直接引用问题库，不使用生成式 AI。',
    },
    {
      type: 'body',
      text: '现场补充描述由使用者填写，与问题库专业内容分列；报告请经督导人员复核后使用。',
    },
  );
  return { blocks, groups, text: blocks.map((b) => b.text).join('\n\n') };
}

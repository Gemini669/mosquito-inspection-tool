import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DRAFT_KEY,
  normalizeLibrary,
  filterLibrary,
  newDraft,
  localDate,
  validateDraft,
  loadDraft,
  saveDraft,
  groupObservations,
  buildReport,
} from '../src/core.js';
import { createWordBlob, reportFilename } from '../src/word.js';

const source = JSON.parse(readFileSync(new URL('../src/data/library.json', import.meta.url)));
const records = normalizeLibrary(source);
const validDraft = () => ({
  ...newDraft(source.sha256),
  location: '测试街道',
  date: '2026-10-19',
  observations: [{ key: 'one', problemId: 'M001', point: '宿舍一楼', description: '' }],
});
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
};

test('Excel source SHA, all 138 identities, 17 fields, 10 domains and 12 categories', () => {
  const workbook = readFileSync(new URL(`../${source.source}`, import.meta.url));
  assert.equal(createHash('sha256').update(workbook).digest('hex'), source.sha256);
  assert.equal(source.recordCount, 138);
  assert.equal(records.length, 138);
  assert.equal(source.headers.length, 17);
  assert.deepEqual(
    records.map((r) => r.id),
    Array.from({ length: 138 }, (_, i) => `M${String(i + 1).padStart(3, '0')}`),
  );
  assert.equal(new Set(records.map((r) => r.domain)).size, 10);
  assert.equal(new Set(records.map((r) => r.categoryId)).size, 12);
  for (const record of records) {
    assert.deepEqual(Object.keys(record.raw), source.headers);
    for (const value of Object.values(record.raw))
      assert.ok(typeof value === 'string' && value.length > 0);
    for (const url of record.raw['权威依据网址'].split('\n'))
      assert.equal(new URL(url).protocol, 'https:');
  }
});

test('re-import is deterministic and compares every source cell without rewriting files', () => {
  const before = readFileSync(new URL('../src/data/library.json', import.meta.url));
  execFileSync('python3', ['scripts/import_excel.py', '--check']);
  assert.deepEqual(readFileSync(new URL('../src/data/library.json', import.meta.url)), before);
});

test('each question matches its exact ID; compound filters and all-source keyword search', () => {
  for (const record of records) {
    assert.deepEqual(
      filterLibrary(records, { keyword: record.id }).map((r) => r.id),
      [record.id],
    );
    assert.ok(filterLibrary(records, { keyword: record.advice }).some((r) => r.id === record.id));
  }
  assert.equal(
    filterLibrary(records, {
      keyword: '  m001 积水 ',
      domain: records[0].domain,
      categoryId: 'H01',
    }).length,
    1,
  );
  assert.equal(filterLibrary(records, { keyword: 'M001', categoryId: 'H12' }).length, 0);
  assert.equal(filterLibrary(records, { keyword: '没有这条问题-xyz' }).length, 0);
  assert.equal(filterLibrary(records).length, 138);
});

test('category grouping keeps different consequences and deduplicates only exact source strings', () => {
  const draft = validDraft();
  draft.observations = ['M001', 'M002', 'M011', 'M012', 'M119', 'M001'].map((problemId, i) => ({
    key: `key${i}`,
    problemId,
    point: `点位${i}`,
    description: `发现${i}`,
  }));
  const groups = groupObservations(draft, records);
  assert.equal(groups.length, 2);
  const h01 = groups.find((g) => g.id === 'H01');
  assert.equal(h01.items.length, 5);
  assert.equal(h01.consequences.length, 3);
  assert.deepEqual(h01.consequences[0].references, [1, 2, 6]);
  assert.equal(h01.consequences[1].text, records.find((r) => r.id === 'M011').consequence);
  assert.deepEqual(
    h01.items.filter((i) => i.record.id === 'M001').map((i) => i.observation.point),
    ['点位0', '点位5'],
  );
});

test('report preserves all 138 problems, distinct consequences, point notes and independent advice', () => {
  const draft = validDraft();
  draft.description = '总说明：现场核查';
  draft.observations = records.map((r, i) => ({
    key: r.id,
    problemId: r.id,
    point: `独立点位-${i}`,
    description: `现场原文-${i}`,
  }));
  const report = buildReport(draft, records, source);
  assert.equal(report.groups.length, 12);
  assert.equal(report.groups.flatMap((g) => g.items).length, 138);
  assert.equal(report.blocks.filter((b) => b.type === 'subheading').length, 138);
  for (const [i, record] of records.entries()) {
    const item = report.groups.flatMap((g) => g.items).find((x) => x.record.id === record.id);
    assert.equal(item.record.advice, record.raw['疾控中心技术建议']);
    const start = report.blocks.findIndex(
      (b) => b.type === 'subheading' && b.text.startsWith(`记录 #${i + 1}｜`),
    );
    const end = report.blocks.findIndex((b, n) => n > start && b.type !== 'body');
    const entryText = report.blocks
      .slice(start, end === -1 ? undefined : end)
      .map((b) => b.text)
      .join('\n');
    for (const value of [
      record.id,
      record.domain,
      record.problem,
      record.advice,
      record.raw['协作责任方（建议）'],
      record.raw['建议复核点'],
      record.raw['整改时效建议（非强制）'],
      record.raw['疾病适用'],
      record.raw['权威依据网址'],
      `独立点位-${i}`,
      `现场原文-${i}`,
    ]) {
      assert.ok(entryText.includes(value), `记录遗漏 ${record.id}: ${value}`);
    }
    assert.ok(report.text.includes(record.consequence), `${record.id} 后果被遗漏`);
  }
});

test('report rejects missing required metadata, empty selection, missing points and unknown IDs', () => {
  const cases = [
    [
      (d) => {
        d.location = '';
      },
      /督导地点/,
    ],
    [
      (d) => {
        d.date = '';
      },
      /督导日期/,
    ],
    [
      (d) => {
        d.date = '2026-02-31';
      },
      /损坏/,
    ],
    [
      (d) => {
        d.observations = [];
      },
      /至少选择/,
    ],
    [
      (d) => {
        d.observations[0].point = '  ';
      },
      /第 1 条/,
    ],
    [
      (d) => {
        d.observations[0].problemId = 'M999';
      },
      /未知问题/,
    ],
  ];
  for (const [edit, expected] of cases) {
    const draft = validDraft();
    edit(draft);
    assert.throws(() => buildReport(draft, records, source), expected);
  }
});

test('draft save and restore retain every observation and metadata, including partial drafts', () => {
  const storage = memoryStorage();
  assert.equal(loadDraft(storage, records, source.sha256), null);
  const draft = validDraft();
  draft.date = '';
  draft.location = '';
  draft.observations.push({
    key: 'two',
    problemId: 'M001',
    point: '第二点位',
    description: '第二条记录',
  });
  const saved = saveDraft(storage, draft, records, source.sha256);
  assert.deepEqual(loadDraft(storage, records, source.sha256), saved);
  assert.ok(saved.updatedAt);
  assert.equal(localDate(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
});

test('corrupt, old-library, duplicate and unknown-record drafts fail without overwriting original', () => {
  const storage = memoryStorage();
  for (const content of [
    '{broken',
    JSON.stringify({}),
    JSON.stringify({ ...validDraft(), librarySha256: 'other' }),
  ]) {
    storage.setItem(DRAFT_KEY, content);
    assert.throws(() => loadDraft(storage, records, source.sha256));
    assert.equal(storage.getItem(DRAFT_KEY), content);
  }
  const draft = validDraft();
  draft.observations.push({ ...draft.observations[0] });
  assert.throws(() => validateDraft(draft, records, source.sha256), /重复/);
  draft.observations[1].key = 'different';
  draft.observations[1].problemId = 'M999';
  assert.throws(() => validateDraft(draft, records, source.sha256), /未知/);
  assert.throws(
    () =>
      saveDraft(
        {
          setItem() {
            throw new Error('quota');
          },
        },
        validDraft(),
        records,
        source.sha256,
      ),
    /quota/,
  );
});

test('Word is a valid OOXML ZIP and preserves all report paragraphs, Unicode and escaped input', async () => {
  const draft = validDraft();
  draft.location = '测试 <地点> & 单位';
  draft.description = '<script>alert("现场")</script>\n第二行 & 复核';
  draft.observations = records.map((r, i) => ({
    key: r.id,
    problemId: r.id,
    point: `现场 <${i}> & ${i}`,
    description: `第一行\n第二行 ${r.id}`,
  }));
  const report = buildReport(draft, records, source);
  const blob = await createWordBlob(report);
  assert.equal(
    blob.type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  const dir = mkdtempSync(join(tmpdir(), 'mosquito-word-'));
  try {
    writeFileSync(join(dir, 'report.docx'), Buffer.from(await blob.arrayBuffer()));
    writeFileSync(join(dir, 'expected.json'), JSON.stringify(report.blocks.map((b) => b.text)));
    execFileSync('python3', [
      '-c',
      `
import json, sys
from zipfile import ZipFile
from xml.etree import ElementTree as E
from pathlib import Path
p=Path(sys.argv[1]); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile(p/'report.docx') as z:
 assert z.testzip() is None
 for required in ['[Content_Types].xml','word/document.xml','_rels/.rels','word/styles.xml','word/footer1.xml']:
  assert required in z.namelist(), required
 for name in z.namelist():
  if name.endswith('.xml'): E.fromstring(z.read(name))
 root=E.fromstring(z.read('word/document.xml'))
 paragraphs=[]
 for paragraph in root.findall('w:body/w:p', ns):
  text=''
  for el in paragraph.iter():
   if el.tag=='{'+ns['w']+'}t': text += el.text or ''
   elif el.tag=='{'+ns['w']+'}br': text += '\\n'
  paragraphs.append(text)
 expected=json.loads((p/'expected.json').read_text())
 assert paragraphs == expected, 'Word report paragraphs differ from preview'
`,
      dir,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(reportFilename(draft), '督导报告_测试 _地点_ & 单位_2026-10-19.docx');
});

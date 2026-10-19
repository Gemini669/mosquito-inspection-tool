import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const library = JSON.parse(readFileSync(new URL('../../src/data/library.json', import.meta.url)));
const problem = (id) => library.records.find((r) => r['问题编号'] === id);

async function select(page, id) {
  await page.getByRole('searchbox', { name: '关键词搜索' }).fill(id);
  await page
    .getByRole('checkbox', { name: `选择 ${id} ${problem(id)['可能发现的问题']}`, exact: true })
    .check();
}
async function basic(page) {
  await page.goto('/');
  await page.getByLabel('督导地点', { exact: false }).fill('测试街道社区');
  await page.getByLabel('督导日期', { exact: false }).fill('2026-10-19');
}

test('search, filters, multi-point records, restoration, report, copy and real Word download', async ({
  page,
  context,
}, testInfo) => {
  const errors = [];
  const outbound = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== 'http://127.0.0.1:4173') outbound.push(r.url());
  });
  await basic(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('V1.0');
  await expect(page.locator('#result-count')).toHaveText('138 / 138');
  await page
    .getByLabel('工作领域', { exact: true })
    .selectOption(problem('M001')['工作领域（统一）']);
  await page.getByLabel('后果类别', { exact: true }).selectOption('H12');
  await expect(page.locator('#problem-list')).toContainText('没有匹配的问题');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await select(page, 'M001');
  await page.locator('.observation [data-field=point]').fill('A栋天台');
  await page.locator('.observation [data-field=description]').fill('现场有3个积水容器');
  await page.getByRole('button', { name: '同一问题增加点位', exact: false }).click();
  await page.locator('.observation [data-field=point]').nth(1).fill('B栋302室');
  await select(page, 'M011');
  await page.locator('.observation [data-field=point]').nth(2).fill('C栋花园');
  await select(page, 'M119');
  await page.locator('.observation [data-field=point]').nth(3).fill('社区卫生服务中心');
  await expect(page.locator('#selected-count')).toHaveText('4');
  await page.getByRole('searchbox').fill('完全无匹配的字符ABC');
  await expect(page.locator('#selected-count')).toHaveText('4');
  await page.reload();
  await expect(page.locator('#selected-count')).toHaveText('4');
  await expect(page.getByLabel('督导地点', { exact: false })).toHaveValue('测试街道社区');
  await expect(page.locator('.observation [data-field=point]').nth(1)).toHaveValue('B栋302室');
  await page.getByRole('button', { name: '生成报告 / 预览', exact: false }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#report-content')).toContainText(
    '现场记录：4 条；涉及问题：3 项；后果类别：2 类',
  );
  await expect(page.locator('#report-content')).toContainText('后果 1（关联记录 #1、#2）');
  for (const id of ['M001', 'M011', 'M119']) {
    for (const h of ['可能发现的问题', '可能造成的不良后果', '疾控中心技术建议']) {
      await expect(page.locator('#report-content')).toContainText(problem(id)[h]);
    }
  }
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制文字', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('B栋302室');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Word', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('督导报告_测试街道社区_2026-10-19.docx');
  const file = testInfo.outputPath('report.docx');
  await download.saveAs(file);
  const text = execFileSync(
    'python3',
    [
      '-c',
      'import sys;from zipfile import ZipFile;from xml.etree import ElementTree as E;z=ZipFile(sys.argv[1]);assert z.testzip() is None;print("".join(E.fromstring(z.read("word/document.xml")).itertext()))',
      file,
    ],
    { encoding: 'utf8' },
  );
  for (const s of [
    'A栋天台',
    'B栋302室',
    'C栋花园',
    '社区卫生服务中心',
    problem('M001')['疾控中心技术建议'],
  ])
    expect(text).toContain(s);
  expect(errors).toEqual([]);
  expect(outbound).toEqual([]);
});

test('required fields, safe user text, responsive layout and keyboard dialog close', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '生成报告 / 预览', exact: false }).click();
  await expect(page.locator('#notice')).toContainText('督导地点');
  await page.getByLabel('督导地点', { exact: false }).fill('<img src=x onerror=alert(1)>');
  await select(page, 'M001');
  await page.getByRole('button', { name: '生成报告 / 预览', exact: false }).click();
  await expect(page.locator('#notice')).toContainText('具体点位');
  await page.locator('.observation [data-field=point]').fill('<script>danger()</script>');
  await page.getByRole('button', { name: '生成报告 / 预览', exact: false }).click();
  await expect(page.locator('#report-content')).toContainText('<script>danger()</script>');
  await expect(page.locator('#report-content script, #report-content img')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const obs = await page.locator('.records-panel').boundingBox();
  expect(obs.x).toBeGreaterThanOrEqual(0);
  expect(obs.x + obs.width).toBeLessThanOrEqual(page.viewportSize().width);
});

test('draft backup/import, corrupt data protection, empty draft date and removal of saved data', async ({
  page,
}, testInfo) => {
  await basic(page);
  await select(page, 'M002');
  await page.locator('.observation [data-field=point]').fill('第二点位');
  const backupPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份草稿', exact: true }).click();
  const backup = await backupPromise;
  const file = testInfo.outputPath('draft.json');
  await backup.saveAs(file);
  const content = JSON.parse(readFileSync(file, 'utf8'));
  expect(content.observations[0].point).toBe('第二点位');
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '新建督导', exact: true }).click();
  await expect(page.locator('#selected-count')).toHaveText('0');
  await page.locator('#import-draft').setInputFiles(file);
  await expect(page.locator('#selected-count')).toHaveText('1');
  await expect(page.locator('.observation [data-field=point]')).toHaveValue('第二点位');
  await page.getByLabel('督导日期', { exact: false }).fill('');
  await page.reload();
  await expect(page.getByLabel('督导日期', { exact: false })).toHaveValue('');
  await page.evaluate(() => localStorage.setItem('mosquito-inspection:draft:v1', '{broken'));
  await page.reload();
  await expect(page.locator('#notice')).toContainText('原草稿未被覆盖');
  await page.getByLabel('督导地点', { exact: false }).fill('不能覆盖损坏的草稿');
  expect(await page.evaluate(() => localStorage.getItem('mosquito-inspection:draft:v1'))).toBe(
    '{broken',
  );
  await page.getByRole('button', { name: '新建督导', exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem('mosquito-inspection:draft:v1')),
  ).toBeNull();
});

test('batch selection and deselection confirmation preserve edited points on cancel', async ({
  page,
}) => {
  await basic(page);
  await page.getByRole('searchbox').fill('M001');
  await page.getByRole('button', { name: '勾选当前结果', exact: true }).click();
  await page.locator('.observation [data-field=point]').fill('必须保留');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.observation [data-field=point]')).toHaveValue('必须保留');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('checkbox').uncheck();
  await expect(page.locator('#selected-count')).toHaveText('0');
});

test('copy fallback remains usable when browser clipboard permission is denied', async ({
  page,
}) => {
  await basic(page);
  await select(page, 'M001');
  await page.locator('.observation [data-field=point]').fill('复制回退测试点');
  await page.getByRole('button', { name: '生成报告 / 预览', exact: false }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Permission denied');
        },
      },
      configurable: true,
    }),
  );
  await page.getByRole('button', { name: '复制文字', exact: true }).click();
  await expect(page.locator('#copy-text')).toBeVisible();
  await expect(page.locator('#copy-text')).toHaveValue(/复制回退测试点/);
  await expect(page.locator('#report-status')).toContainText('浏览器未允许自动复制');
  expect(
    await page.locator('#copy-text').evaluate((el) => el.selectionEnd - el.selectionStart),
  ).toBeGreaterThan(0);
});

test('storage failure is shown and a backup still contains unsaved site records', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage quota exceeded');
    };
  });
  await basic(page);
  await select(page, 'M001');
  await page.locator('.observation [data-field=point]').fill('存储失败仍可备份');
  await expect(page.locator('#draft-status')).toContainText('保存失败');
  await expect(page.locator('#notice')).toContainText('草稿未保存');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份草稿', exact: true }).click();
  const download = await downloadPromise;
  const file = testInfo.outputPath('unsaved-draft.json');
  await download.saveAs(file);
  expect(JSON.parse(readFileSync(file, 'utf8')).observations[0].point).toBe('存储失败仍可备份');
});

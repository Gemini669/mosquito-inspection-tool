#!/usr/bin/env python3
"""Import the source workbook without third-party packages; never rewrite it."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '问题-建议 清单（合并后） V1.xlsx'
OUTPUT = ROOT / 'src/data/library.json'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HEADERS = ['序号', '问题编号', '工作领域（统一）', '可能发现的问题', '可能造成的不良后果',
           '后果类别编号', '后果类别名称', '疾控中心技术建议', '协作责任方（建议）', '建议复核点',
           '整改时效建议（非强制）', '疾病适用', '权威依据网址', '现场状态', '原始编号与来源',
           '原始场景分类', '合并说明']


def text_content(element):
    return ''.join(t.text or '' for t in element.findall('.//s:t', NS))


def read_library():
    with ZipFile(SOURCE) as archive:
        if archive.testzip() is not None:
            raise ValueError('Excel ZIP 完整性校验失败')
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [text_content(s) for s in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in
                         ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheet = next(s for s in workbook.find('s:sheets', NS) if s.attrib['name'] == '问题建议库')
        target = relationships[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        rows = []
        for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
            values = [''] * len(HEADERS)
            for cell in row.findall('s:c', NS):
                letters = re.match(r'[A-Z]+', cell.attrib['r']).group()
                index = 0
                for char in letters:
                    index = index * 26 + ord(char) - ord('A') + 1
                if cell.find('s:f', NS) is not None:
                    raise ValueError('问题库包含公式，须人工审核后导入')
                value = cell.find('s:v', NS)
                value = value.text or '' if value is not None else ''
                if cell.attrib.get('t') == 's':
                    value = shared[int(value)]
                elif cell.attrib.get('t') == 'inlineStr':
                    value = text_content(cell)
                if index > len(HEADERS):
                    if value:
                        raise ValueError('出现未审核的新字段')
                else:
                    values[index - 1] = value
            if any(values):
                rows.append(values)
    if rows[0] != HEADERS:
        raise ValueError('Excel 字段与预期不符')
    records = [dict(zip(HEADERS, row)) for row in rows[1:]]
    if [r['问题编号'] for r in records] != [f'M{i:03d}' for i in range(1, 139)]:
        raise ValueError('问题编号或数量发生变化，请审核源文件版本')
    for r in records:
        if any(not r[h] for h in HEADERS):
            raise ValueError(f"{r['问题编号']} 有空字段")
    return {'source': SOURCE.name, 'sheet': '问题建议库',
            'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            'headers': HEADERS, 'recordCount': len(records), 'records': records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = read_library()
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding='utf-8') != rendered:
            raise SystemExit('数据与 Excel 不一致，请执行 npm run data:import 并审核差异')
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(rendered, encoding='utf-8')
    print(f"问题建议库：{data['recordCount']} 条；{len(HEADERS)} 字段；"
          f"{len(set(r['工作领域（统一）'] for r in data['records']))} 个工作领域；"
          f"{len(set(r['后果类别编号'] for r in data['records']))} 个后果类别；"
          f"{'一致性校验通过' if args.check else '导入完成'}")


if __name__ == '__main__':
    main()

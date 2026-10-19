import { Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, TextRun } from 'docx';

export async function createWordBlob(report) {
  const heading = {
    title: HeadingLevel.TITLE,
    heading: HeadingLevel.HEADING_1,
    subheading: HeadingLevel.HEADING_2,
  };
  const paragraphs = report.blocks.map(
    (block) =>
      new Paragraph({
        heading: heading[block.type],
        spacing: { after: 140, line: 340 },
        keepNext: block.type !== 'body',
        children: block.text
          .split('\n')
          .map((text, i) => new TextRun({ text, ...(i ? { break: 1 } : {}) })),
      }),
  );
  const document = new Document({
    creator: '登革热与基孔肯雅热督导系统',
    title: '登革热与基孔肯雅热督导报告',
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Calibri', eastAsia: '宋体', hAnsi: 'Calibri' }, size: 24 },
          paragraph: { spacing: { after: 140 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: 'center',
                children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页'] })],
              }),
            ],
          }),
        },
        children: paragraphs,
      },
    ],
  });
  return Packer.toBlob(document);
}

export function reportFilename(draft) {
  const location =
    draft.location
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
      .trim()
      .slice(0, 70) || '未命名地点';
  return `督导报告_${location}_${draft.date}.docx`;
}

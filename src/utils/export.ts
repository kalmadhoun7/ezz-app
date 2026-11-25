import * as XLSX from 'xlsx';

/**
 * Generates a UTF-8 with BOM CSV string so Microsoft Excel renders Arabic cleanly.
 */
export function buildUtf8BomCsv(headers: string[], rows: (string | number)[][]): string {
  const escapeCell = (val: string | number) => {
    const str = String(val ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = 'text/csv;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ExcelSheetInput {
  name: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
}

export function exportXlsxWorkbook(
  sheets: ExcelSheetInput[],
  filename: string
): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  for (const s of sheets) {
    const aoa: (string | number)[][] = [];
    if (s.title) aoa.push([s.title]);
    if (s.subtitle) aoa.push([s.subtitle]);
    if (s.title || s.subtitle) aoa.push([]);

    aoa.push(s.headers);
    for (const r of s.rows) aoa.push(r);
    if (s.totalsRow) aoa.push(s.totalsRow);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!views'] = [{ rightToLeft: true }];

    // Auto-fit column widths based on max character length
    const colCount = s.headers.length;
    const cols: XLSX.ColInfo[] = [];
    for (let c = 0; c < colCount; c++) {
      let maxLen = String(s.headers[c] ?? '').length;
      for (const r of s.rows) {
        maxLen = Math.max(maxLen, String(r[c] ?? '').length);
      }
      if (s.totalsRow) {
        maxLen = Math.max(maxLen, String(s.totalsRow[c] ?? '').length);
      }
      cols.push({ wch: Math.min(40, Math.max(14, maxLen + 4)) });
    }
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

export interface PdfReportInput {
  title: string;
  subtitle?: string;
  meta?: { label: string; value: string }[];
  headers: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
}

/**
 * Generates a clean RTL HTML+CSS document and opens the browser's Print-to-PDF dialog.
 * Works 100% offline with native Arabic shaping and zero extra PDF library bloat.
 */
export function exportHtmlPdfReport(report: PdfReportInput): void {
  const escapeHtml = (val: string | number) =>
    String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const metaHtml =
    report.meta && report.meta.length > 0
      ? `<div class="meta-grid">${report.meta
          .map(
            (m) =>
              `<div class="meta-card"><span class="meta-label">${escapeHtml(
                m.label
              )}</span><strong class="meta-val">${escapeHtml(m.value)}</strong></div>`
          )
          .join('')}</div>`
      : '';

  const headersHtml = `<tr>${report.headers
    .map((h) => `<th>${escapeHtml(h)}</th>`)
    .join('')}</tr>`;

  const rowsHtml = report.rows
    .map(
      (r) =>
        `<tr>${r
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('');

  const totalsHtml = report.totalsRow
    ? `<tfoot><tr class="totals-row">${report.totalsRow
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join('')}</tr></tfoot>`
    : '';

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif;
      direction: rtl;
      color: #0f172a;
      margin: 0;
      padding: 16px;
      background: #ffffff;
    }
    .header {
      border-bottom: 2px solid #0f766e;
      padding-bottom: 10px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      color: #0f766e;
    }
    .header p {
      margin: 4px 0 0;
      font-size: 12px;
      color: #475569;
    }
    .print-date {
      font-size: 11px;
      color: #64748b;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
      margin-bottom: 14px;
    }
    .meta-card {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .meta-label {
      display: block;
      font-size: 10px;
      color: #64748b;
    }
    .meta-val {
      font-size: 13px;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      background: #0f766e;
      color: #ffffff;
      padding: 9px 10px;
      text-align: right;
      font-weight: 700;
      border: 1px solid #0f766e;
    }
    td {
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      text-align: right;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .totals-row td {
      background: #ccfbf1;
      color: #134e4a;
      font-weight: 700;
      border-top: 2px solid #0f766e;
    }
    @media print {
      body { padding: 0; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .totals-row td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(report.title)}</h1>
      ${report.subtitle ? `<p>${escapeHtml(report.subtitle)}</p>` : ''}
    </div>
    <div class="print-date">تاريخ التقرير: ${new Date().toLocaleDateString('ar-EG')}</div>
  </div>
  ${metaHtml}
  <table>
    <thead>${headersHtml}</thead>
    <tbody>${rowsHtml}</tbody>
    ${totalsHtml}
  </table>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 1000);
  }, 250);
}

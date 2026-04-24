// كشف حساب PDF - utility
// يتطلب: npm install pdfkit arabic-font

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// استخدم خط عربي مناسب (مثلاً Cairo أو Amiri)
const AR_FONT_PATH = path.join(__dirname, '../public/fonts/Cairo-Regular.ttf');

/**
 * ينشئ كشف حساب PDF من بيانات JSON
 * @param {Array} data - بيانات كشف الحساب (صفوف)
 * @param {string} outPath - مسار حفظ ملف PDF
 * @param {Object} options - خيارات (مثل اسم العميل)
 */
function generateAccountStatementPDF(data, outPath, options = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'portrait', lang: 'ar' });
  doc.registerFont('arabic', AR_FONT_PATH);
  doc.font('arabic');

  // إعداد RTL
  doc.direction = 'rtl';

  // عنوان التقرير
  doc.fontSize(20).fillColor('#000').text('كشف حساب مفصل', { align: 'center' });
  if (options.customerName) {
    doc.moveDown(0.5).fontSize(14).text(`العميل: ${options.customerName}`, { align: 'center' });
  }
  doc.moveDown(1);

  // الأعمدة
  const headers = [
    'الحالة', 'الرصيد', 'دائن', 'مدين', 'البيان', 'المرجع', 'التاريخ'
  ];
  const colWidths = [70, 80, 70, 70, 120, 70, 80];
  const startX = doc.page.width - doc.page.margins.right - colWidths.reduce((a, b) => a + b, 0);
  let y = doc.y;

  // هيدر أخضر
  doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), 30).fill('#27ae60');
  doc.fillColor('#fff').fontSize(13);
  let x = startX;
  headers.forEach((header, i) => {
    doc.text(header, x + 5, y + 7, { width: colWidths[i] - 10, align: 'center' });
    x += colWidths[i];
  });
  doc.fillColor('#000');
  y += 30;

  // الصفوف
  doc.fontSize(11);
  data.forEach(row => {
    x = startX;
    const cells = [
      row.status || '',
      row.balance != null ? String(row.balance) : '',
      row.credit != null ? String(row.credit) : '',
      row.debit != null ? String(row.debit) : '',
      row.document || row.notes || '',
      row.reference || row.reference_id || '',
      formatDate(row.date || row.journal_date)
    ];
    cells.forEach((cell, i) => {
      doc.text(cell, x + 5, y + 7, { width: colWidths[i] - 10, align: 'center' });
      x += colWidths[i];
    });
    y += 25;
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = doc.y;
    }
  });

  doc.end();
  doc.pipe(fs.createWriteStream(outPath));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth()+1).toString().padStart(2, '0')}-${d.getFullYear()}`;
}

export { generateAccountStatementPDF };

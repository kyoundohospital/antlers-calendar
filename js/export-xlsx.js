// カレンダーを Excel（.xlsx）として書き出す。
// 印刷レイアウト（A3横・7月始まり12か月横並び・12月と1月の間に綴じ代列）と同じ形にする。
// 外部ライブラリを使わず、xlsx（= XMLファイルを詰めたZIP）を自前で組み立てている。

import { monthsOfSeason } from './config.js';
import { getHolidayName } from './holidays.js';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
const HOME_AWAY_LABEL = { home: 'H', away: 'A', neutral: '中立' };
const STATUS_LABEL = { postponed: '延期', canceled: '中止' };

// アプリの CSS と同じ色
const ACCENT = 'B71840';
const SAT_BG = 'E3F2FD';
const SUN_BG = 'FDECEA';
const EMPTY_BG = 'FAFAFA';
const GUTTER_BG = 'ECEFF1';
const WIN = '2E7D32';
const LOSS = 'C62828';
const DRAW = '757575';
const FONT = 'Arial';

// ---- ZIP（無圧縮）----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (arr) => {
    chunks.push(arr);
    offset += arr.length;
  };
  const header = (size) => new DataView(new ArrayBuffer(size));

  for (const { name, content } of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);

    const local = header(30);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // 展開に必要なバージョン
    local.setUint16(6, 0x0800, true); // ファイル名はUTF-8
    local.setUint16(8, 0, true); // 無圧縮
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const localOffset = offset;
    push(new Uint8Array(local.buffer));
    push(nameBytes);
    push(data);

    const dir = header(46);
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, localOffset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
  }

  const centralOffset = offset;
  for (const arr of central) push(arr);
  const end = header(22);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, offset - centralOffset, true);
  end.setUint32(16, centralOffset, true);
  push(new Uint8Array(end.buffer));

  return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- xlsx の組み立て ----

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// セル内の書式付き文字列（文字ごとに色・太字・大きさを変える）
function runs(parts) {
  return parts
    .filter((p) => p && p.text)
    .map(({ text, color, bold, size = 8 }) => {
      const props = [
        bold ? '<b/>' : '',
        `<sz val="${size}"/>`,
        color ? `<color rgb="FF${color}"/>` : '',
        `<rFont val="${FONT}"/>`,
      ].join('');
      return `<r><rPr>${props}</rPr><t xml:space="preserve">${esc(text)}</t></r>`;
    })
    .join('');
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="9"/><name val="${FONT}"/></font>
<font><b/><sz val="14"/><color rgb="FF${ACCENT}"/><name val="${FONT}"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="${FONT}"/></font>
</fonts>
<fills count="7">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${ACCENT}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${SAT_BG}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${SUN_BG}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${EMPTY_BG}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${GUTTER_BG}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D0D0"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border>
<border><left style="thick"><color rgb="FF${ACCENT}"/></left><right style="thin"><color rgb="FFD0D0D0"/></right><top style="thin"><color rgb="FFD0D0D0"/></top><bottom style="thin"><color rgb="FFD0D0D0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf xfId="0" numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf xfId="0" numFmtId="0" fontId="2" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="6" borderId="1" applyFill="1" applyBorder="1"/>
<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="2" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="3" borderId="2" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf xfId="0" numFmtId="0" fontId="0" fillId="4" borderId="2" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// 平日/土/日(祝) × 試合の有無 に対応する書式番号
const STYLE = {
  title: 1,
  monthHeader: 2,
  empty: 6,
  gutter: 7,
  day: { weekday: 3, sat: 4, sun: 5 },
  dayMatch: { weekday: 8, sat: 9, sun: 10 },
};

function colLetter(index) {
  let n = index;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 月インデックス(0-11) -> 列番号（7列目は綴じ代）
const columnOf = (i) => (i < 6 ? i + 1 : i + 2);

function resultColor(note) {
  if (/敗戦|敗退/.test(note)) return LOSS;
  if (/引分/.test(note)) return DRAW;
  if (/勝利/.test(note)) return WIN;
  return '555555';
}

// 1マスの中身を組み立てる（カレンダー画面のマスと同じ並び）
function cellRuns({ day, dow, holidayName, matches, placeNames }) {
  const dateColor = dow === 0 || holidayName ? LOSS : dow === 6 ? '1565C0' : '555555';
  const parts = [{ text: `${day} (${WEEKDAY_JA[dow]})`, color: dateColor, bold: true, size: 9 }];
  if (holidayName) parts.push({ text: ` ${holidayName}`, color: LOSS, size: 7 });
  if (!matches.length) return parts;

  const first = matches[0];
  const meta = [first.kickoffTime, HOME_AWAY_LABEL[first.homeAway]].filter(Boolean).join(' ');
  if (meta) parts.push({ text: `  ${meta}`, color: '555555' });
  if (placeNames.length) parts.push({ text: `  [${placeNames.join('・')}]`, color: ACCENT, bold: true });

  for (const m of matches) {
    const status = STATUS_LABEL[m.status] ? `［${STATUS_LABEL[m.status]}］` : '';
    const tentative = m.altDate ? '（日程未定）' : '';
    parts.push({ text: `\n${m.competition}${tentative}${status}`, color: ACCENT, bold: true });
    parts.push({ text: `\nvs ${m.opponent || '未定'}` });
    if (m.status === 'finished' && m.note) {
      parts.push({ text: `\n${m.note}`, color: resultColor(m.note), bold: true });
    } else if (m.venue) {
      parts.push({ text: `\n${m.venue}`, color: '666666' });
    }
  }
  return parts;
}

function sheetXml({ seasonYear, matchesByDate, viewingPlaces, viewingPlans }) {
  const months = monthsOfSeason(seasonYear);
  const cols = months
    .map((_, i) => `<col min="${columnOf(i)}" max="${columnOf(i)}" width="21" customWidth="1"/>`)
    .join('');
  const rows = [];

  rows.push(
    `<row r="1" ht="24" customHeight="1"><c r="A1" s="${STYLE.title}" t="inlineStr"><is><t>${esc(
      `鹿島アントラーズ観戦カレンダー　${seasonYear}年度（${seasonYear}/7〜${seasonYear + 1}/6）`
    )}</t></is></c></row>`
  );

  const headerCells = months
    .map(
      ({ year, month }, i) =>
        `<c r="${colLetter(columnOf(i))}2" s="${STYLE.monthHeader}" t="inlineStr"><is><t>${year}年 ${month}月</t></is></c>`
    )
    .join('');
  rows.push(`<row r="2" ht="20" customHeight="1">${headerCells}<c r="G2" s="${STYLE.gutter}"/></row>`);

  for (let day = 1; day <= 31; day++) {
    const rowNum = day + 2;
    const cells = months.map(({ year, month }, i) => {
      const ref = `${colLetter(columnOf(i))}${rowNum}`;
      const daysInMonth = new Date(year, month, 0).getDate();
      if (day > daysInMonth) return `<c r="${ref}" s="${STYLE.empty}"/>`;

      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dow = new Date(year, month - 1, day).getDay();
      const holidayName = getHolidayName(dateStr);
      const matches = matchesByDate.get(dateStr) || [];
      const placeNames = matches
        .map((m) => viewingPlans && viewingPlans[m.id])
        .filter((plan) => plan && plan.viewingPlaceId)
        .map((plan) => viewingPlaces.find((p) => p.id === plan.viewingPlaceId))
        .filter(Boolean)
        .map((place) => place.name);

      const kind = dow === 0 || holidayName ? 'sun' : dow === 6 ? 'sat' : 'weekday';
      const style = (matches.length ? STYLE.dayMatch : STYLE.day)[kind];
      const content = runs(cellRuns({ day, dow, holidayName, matches, placeNames }));
      return `<c r="${ref}" s="${style}" t="inlineStr"><is>${content}</is></c>`;
    });
    cells.push(`<c r="G${rowNum}" s="${STYLE.gutter}"/>`);
    rows.push(`<row r="${rowNum}" ht="46" customHeight="1">${cells.join('')}</row>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}<col min="7" max="7" width="2.5" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
<mergeCells count="1"><mergeCell ref="A1:M1"/></mergeCells>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.3" right="0.3" top="0.3" bottom="0.3" header="0" footer="0"/>
<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="1"/>
</worksheet>`;
}

export function buildCalendarWorkbook(opts) {
  const sheetName = `${opts.seasonYear}年度`;
  return zip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${esc(sheetName)}'!$1:$2</definedName></definedNames>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(opts) },
  ]);
}

export function downloadCalendarXlsx(opts) {
  const blob = buildCalendarWorkbook(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `アントラーズ観戦カレンダー_${opts.seasonYear}年度.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// xlsx.js — 原版「极简记工时」Excel 兼容层（零依赖，纯 vanilla）
// 读：解压 xlsx（zip+deflate-raw，DecompressionStream 门控）→ 正则提取共享字符串与单元格
// 写：STORE 方式打包最小 xlsx（inline strings，与原版导出列布局一致）
// 约束：不 import store.js，Node 环境可测（DOMParser 不依赖）

// ---------- 通用 ----------

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function xmlEsc(t) {
  return String(t).replace(/[&<>"]/g, (c) => XML_ESC[c]);
}

// 读侧与 xmlEsc 对称：Excel/自产 xlsx 的文本节点可能含实体，读回必须还原成原文，
// 否则「导出 xlsx → 再导入」会把 & < > " 变成 &amp; &lt; … 实体文本（数据不保真）
const XML_UNESC = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function xmlUnesc(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e.charAt(0) === '#') {
      const hex = e.charAt(1) === 'x' || e.charAt(1) === 'X';
      const n = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      // 排除 0 / 代理区 / 越界码点，避免 fromCodePoint 抛错或注入异常字符
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n) : m;
    }
    const v = XML_UNESC[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// 空值合并的兼容写法：老内核（Chromium <80）不支持 ??，会整模块语法报错（与 store.js 同约定）
function nz(v) {
  return v == null ? '' : v;
}

export function colLetters(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---------- 解压（读 xlsx）----------

// 防 zip 炸弹：单条目解压后上限与全包累计上限（正常原版导出 <100KB，留百倍余量）
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

async function inflateRaw(raw) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('此浏览器内核过旧，无法解压 Excel——请用系统浏览器或 Chrome 打开本页后重试');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  // 增量读取并设上限：arrayBuffer() 一口气读完无法中途中止，超大膨胀会直接撑爆内存
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ENTRY_BYTES) {
      try { await reader.cancel(); } catch (_) { /* 取消失败也直接中止 */ }
      throw new Error('文件解压后体积异常（可能已损坏或不是正常的 Excel 导出），已中止');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
  return out;
}

export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的压缩包文件');
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const entries = {};
  let totalInflated = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > bytes.length || view.getUint32(off, true) !== 0x02014b50) break;
    const method = view.getUint16(off + 10, true);
    const csize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    if (localOff + 30 <= bytes.length) {
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + csize);
      const data = method === 8 ? await inflateRaw(raw) : raw; // 0(STORE)/未知方法原样取
      totalInflated += data.length;
      if (totalInflated > MAX_TOTAL_BYTES) throw new Error('压缩包内容总量异常，已中止');
      entries[name] = data;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// 从机器生成的 XML 里按标签提取（xlsx 的 XML 由 Excel 导出，结构稳定）
function tagBlocks(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>|<' + tag + '(?:\\s[^>]*)?/>', 'g');
  let m;
  while ((m = re.exec(xml)) !== null) out.push({ attrs: m[0].slice(0, m[0].indexOf('>') + 1), inner: nz(m[1]) });
  return out;
}

function attr(block, name) {
  const m = block.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function stripTags(xml) {
  return xmlUnesc(xml.replace(/<[^>]+>/g, ''));
}

// 读第一个工作表 → 二维字符串数组（含表头）
export async function readXlsxRows(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('不是 Excel/压缩包文件');
  }
  const entries = await unzip(bytes);
  const sheetName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
    || Object.keys(entries).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetName) throw new Error('Excel 里没有工作表');
  const decoder = new TextDecoder();
  let shared = [];
  const ssName = Object.keys(entries).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
  if (ssName) {
    const xml = decoder.decode(entries[ssName]);
    shared = tagBlocks(xml, 'si').map((si) => stripTags(si.inner));
  }
  const sheetXml = decoder.decode(entries[sheetName]);
  const rows = [];
  for (const rowBlock of tagBlocks(sheetXml, 'row')) {
    const row = [];
    for (const cell of tagBlocks(rowBlock.inner, 'c')) {
      const ref = attr(cell.attrs, 'r');
      const t = attr(cell.attrs, 't');
      let text = '';
      const vMatch = cell.inner.match(/<v>([\s\S]*?)<\/v>/);
      if (t === 's' && vMatch) text = nz(shared[parseInt(vMatch[1], 10)]);
      else if (t === 'inlineStr') text = stripTags(cell.inner);
      else if (vMatch) text = vMatch[1];
      const col = ref ? colIndex(ref.replace(/\d+/g, '')) : row.length;
      row[col] = text;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? '' : x)));
  }
  return rows;
}

// ---------- 原版格式解析 ----------

// "2小时" / "3小时30分钟" / "2.5小时" / "2" → 小数小时；无效返回 null
export function parseHoursText(s) {
  const str = String(nz(s)).trim();
  if (!str) return null;
  const m = str.match(/^(?:(\d+(?:\.\d+)?)\s*小时)?\s*(?:(\d{1,2})\s*分钟?)?\s*$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const h = m[1] !== undefined ? Number(m[1]) : 0;
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  const total = Math.round((h + min / 60) * 100) / 100;
  return total > 0 && total <= 24 ? total : null;
}

// "转运(18元/时)" → { name: '转运', rate: 18 }；不匹配返回 null
export function parseJobCell(s) {
  const str = String(nz(s)).trim();
  const m = str.match(/^(.{1,50}?)\((\d+(?:\.\d+)?)元\/时\)$/);
  return m ? { name: m[1].trim(), rate: Number(m[2]) } : null;
}

function validDateKey(k) {
  const m = String(k).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dt.getFullYear() === Number(m[1]) && dt.getMonth() === Number(m[2]) - 1 && dt.getDate() === Number(m[3]);
}

function parseDateCell(s) {
  const str = String(nz(s)).trim();
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const key = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return validDateKey(key) ? key : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const ms = (Number(str) - 25569) * 86400000; // Excel serial → UTC
    const dt = new Date(ms);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    return validDateKey(key) ? key : null;
  }
  return null;
}

// 原版「按工时」表（表头：日期/正班工时/正班薪水/加班工时/加班薪水/合计工时/合计薪水/备注）
// → 规范化行 [{date, hours, jobName, rate, income, overtime, note}] + warnings
export function parseOriginalRows(rawRows) {
  const hIdx = rawRows.findIndex((r) => r.some((c) => /^日期/.test(String(c).trim())));
  if (hIdx < 0) throw new Error('Excel 里找不到「日期」表头——请确认是原版 App 导出的表格');
  const head = rawRows[hIdx].map((c) => String(c).trim());
  const col = (name) => head.findIndex((c) => c.startsWith(name));
  const cDate = col('日期');
  const cReg = col('正班工时');
  const cPay = col('正班薪水');
  const cOt = col('加班工时');
  const cTotal = col('合计工时');
  const cIncome = col('合计薪水');
  const cNote = col('备注');
  if (cDate < 0 || (cReg < 0 && cTotal < 0)) throw new Error('表头缺少「日期」或「工时」列');
  const rows = [];
  const warnings = [];
  for (let i = hIdx + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const get = (c) => (c >= 0 && c < r.length ? String(r[c]).trim() : '');
    const date = parseDateCell(get(cDate));
    if (!date) {
      if (get(cDate) || get(cTotal) || get(cPay)) warnings.push(`跳过（日期无效）：第 ${i + 1} 行`);
      continue;
    }
    const hours = parseHoursText(get(cTotal) || get(cReg));
    if (hours === null) {
      warnings.push(`跳过（工时无法识别）：${get(cDate)}`);
      continue;
    }
    const jobCell = get(cPay);
    const job = parseJobCell(jobCell);
    const jobName = job ? job.name : jobCell || '未命名岗位';
    const rate = job ? job.rate : 0;
    if (!job && jobCell) warnings.push(`岗位格式异常（「${jobCell}」），按无时薪岗位导入：${date}`);
    const incomeText = get(cIncome);
    const income = incomeText ? Math.round((Number(incomeText.replace(/[^\d.]/g, '')) || 0) * 100) / 100 : Math.round(hours * rate * 100) / 100;
    rows.push({
      date,
      hours,
      jobName,
      rate,
      income,
      overtime: !!get(cOt) && get(cOt) !== '无',
      note: get(cNote),
    });
  }
  if (!rows.length) throw new Error('Excel 里没有可识别的数据行');
  return { rows, warnings };
}

// ---------- 导出（写 xlsx，STORE 不压缩，inline strings）----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameB.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 文件名
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    chunks.push(lh, data);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true); // 本地头偏移（38 是外部属性位，勿混）
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD 签名 PK\x05\x06
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  const out = new Uint8Array(centralStart + centralSize + 22);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

function hoursText(h) {
  const total = Math.round(Number(h) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return mm ? `${hh}小时${mm}分钟` : `${hh}小时`;
}

// rows: [{date, hours, jobName, rate, income, note}] → 原版布局的 xlsx 字节
export function buildOriginalXlsx(rows) {
  const head = ['日期', '正班工时', '正班薪水', '加班工时', '加班薪水', '合计工时', '合计薪水', '备注'];
  const cellStr = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
  let body = `<row r="1">${head.map((h, i) => cellStr(colLetters(i) + '1', h)).join('')}</row>`;
  rows.forEach((r, i) => {
    const rn = i + 2;
    const cells = [
      cellStr(colLetters(0) + rn, r.date),
      cellStr(colLetters(1) + rn, hoursText(r.hours)),
      cellStr(colLetters(2) + rn, `${r.jobName}(${r.rate}元/时)`),
      cellStr(colLetters(3) + rn, '无'),
      cellStr(colLetters(4) + rn, ''),
      cellStr(colLetters(5) + rn, hoursText(r.hours)),
      cellStr(colLetters(6) + rn, `${Number(r.income).toFixed(2)}元`),
      cellStr(colLetters(7) + rn, r.note || ''),
    ].join('');
    body += `<row r="${rn}">${cells}</row>`;
  });
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="按工时" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`],
  ];
  return zipStore(files);
}

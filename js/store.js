// store.js — 数据层：唯一允许碰 localStorage 的文件
// schema 见 CLAUDE.md；财务字段（rate/income）保存时快照，统计只求和

const KEY = 'slr_data_v1';

export function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey() {
  return toDateKey(new Date());
}

// ---------- 展示格式化 ----------

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 36 → '36'，2.5 → '2.5'，去掉多余的 0 */
export function fmtNum(n) {
  return String(round2(Number(n) || 0));
}

export function fmtHours(h) {
  return fmtNum(h) + 'h';
}

/** 21.5 → '21.50'（月统计卡两位小数，与原 App 一致） */
export function fmtHours2(h) {
  return (Number(h) || 0).toFixed(2) + 'h';
}

/** 工时展示口径：最多一位小数，整数不补零（10.50 → '10.5'，4 → '4'） */
export function fmtHours1(h) {
  return String(Math.round((Number(h) || 0) * 10) / 10);
}

function nz(v) {
  // 空值合并（??）的兼容写法：老内核（Chromium <80）不支持 ??，会整模块语法报错
  return v == null ? '' : v;
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  // toPrecision(12) 缓解常见的 x.xx5 浮点偏差（如 0.29h×20.5元 = 5.944999…→5.95）；
  // 无法覆盖「表示即误差」的极端值（如 1.005），彻底修需 decimal 库，超出无依赖约定
  return Math.round(Number(n.toPrecision(12)) * 100) / 100;
}

function defaultData() {
  return {
    version: 2, // v2：新增 settings.settlementMode（半月结算）；v1 备份由 migrate 补默认值
    jobs: [], // 首次运行为空，不预置岗位；打卡可选「自定义（不设岗位）」或到设置添加
    records: {}, // 'YYYY-MM-DD' -> record
    settings: {
      defaultJobId: null,
      recentDurations: [2, 2.5, 3, 3.5, 4],
      quickFill: { mode: 'last', hours: 3.5, customHours: [] }, // 连打预填：跟随最近记录 / 自定义时长组（覆盖最近档位 chips）
      wallpaper: null, // { dataUrl, opacity 0~1, fit: cover|contain|stretch } 或 null
      settlementMode: 'record', // 'record' 按记录结算 | 'half-month' 每半个月（1–15 / 16–月末）
    },
  };
}

const BROKEN_KEY = 'slr_broken_backup_v1'; // 数据损坏时原始 blob 的备份 key

// ---------- 数据校验（migrate 与 importJSON 的外部数据统一走这里，畸形/注入在入口收敛） ----------

/** 日期 key 合法性：数值比对（本地构造本地读，无时区依赖），天然拒绝溢出日期（2026-02-30） */
function isValidDateKey(k) {
  const m = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function clampNum(v, min, max) {
  const n = Number(v);
  // 不做 round2：hours/amount/rate 是用户原始输入，>2 位小数保留原值保证 JSON roundtrip 一致
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function validTime(v) {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) && +v.slice(0, 2) < 24 && +v.slice(3) < 60 ? v : '';
}

function sanitizeJobs(jobs) {
  const base = defaultData();
  if (!Array.isArray(jobs)) return base.jobs; // 字段缺失/损坏才回退默认；空数组是合法状态（用户删光了岗位）
  return jobs
    .filter((j) => j && typeof j === 'object' && typeof j.id === 'string' && j.id)
    .map((j) => ({ id: j.id, name: String(j.name == null ? '未命名' : j.name).slice(0, 50), rate: clampNum(j.rate, 0, 10000) }));
}

function sanitizeRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return {};
  const out = {};
  for (const [k, r] of Object.entries(records)) {
    if (!isValidDateKey(k)) continue; // 幽灵日期（2026-02-30）在任何入口都不许留存
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const type = r.type === 'day' || r.type === 'time' || r.type === 'hours' ? r.type : 'hours';
    const rec = { type, overtime: !!r.overtime, settled: !!r.settled, note: String(r.note == null ? '' : r.note).slice(0, 200) };
    if (type === 'day') {
      rec.amount = clampNum(r.amount, 0, 1000000);
      rec.jobId = typeof r.jobId === 'string' ? r.jobId : '';
      rec.rate = 0;
      rec.income = rec.amount;
    } else {
      rec.hours = clampNum(r.hours, 0, 24);
      rec.jobId = typeof r.jobId === 'string' ? r.jobId : '';
      rec.rate = clampNum(r.rate, 0, 100000);
      if (type === 'time') {
        rec.start = validTime(r.start);
        rec.end = validTime(r.end);
        if (rec.start && rec.end) rec.hours = timeToHours(rec.start, rec.end);
      }
      rec.income = round2(rec.hours * rec.rate);
    }
    out[k] = rec;
  }
  return out;
}

function sanitizeSettings(s, jobs) {
  const out = {
    defaultJobId: null,
    recentDurations: [2, 2.5, 3, 3.5, 4],
    quickFill: { mode: 'last', hours: 3.5, customHours: [] },
    wallpaper: null,
    settlementMode: 'record', // v2 新增；老备份缺字段时按「按记录结算」兜底，不丢数据
  };
  if (s && typeof s === 'object') {
    if (s.settlementMode === 'half-month') out.settlementMode = 'half-month';
    if (typeof s.defaultJobId === 'string') out.defaultJobId = s.defaultJobId;
    if (Array.isArray(s.recentDurations)) {
      out.recentDurations = [...new Set(
        s.recentDurations.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 24)
      )].slice(0, 5);
    }
    if (s.quickFill && typeof s.quickFill === 'object') {
      const hours = clampNum(s.quickFill.hours, 0.5, 24);
      out.quickFill = { mode: s.quickFill.mode === 'custom' ? 'custom' : 'last', hours: hours || 3.5, customHours: [] };
      if (Array.isArray(s.quickFill.customHours)) {
        out.quickFill.customHours = [...new Set(
          s.quickFill.customHours.map(Number).filter((n) => Number.isFinite(n) && n >= 0.5 && n <= 24)
        )].slice(0, 5);
      }
    }
    if (s.wallpaper === null) {
      out.wallpaper = null;
    } else {
      out.wallpaper = sanitizeWallpaper(s.wallpaper);
    }
  }
  if (!jobs.some((j) => j.id === out.defaultJobId)) {
    out.defaultJobId = jobs[0] ? jobs[0].id : null;
  }
  return out;
}

function migrate(d) {
  const jobs = sanitizeJobs(d && d.jobs);
  return {
    version: 2, // 显式迁移：v1 数据缺 settlementMode，由 sanitizeSettings 补默认值；其余字段全量保留
    jobs,
    records: sanitizeRecords(d && d.records),
    settings: sanitizeSettings(d && d.settings, jobs),
  };
}

let data = null;
let lastSavedJson = null; // 本 tab 最后一次写入的内容，用于识别其他标签页的写入

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultData();
  lastSavedJson = raw;
  return migrate(JSON.parse(raw)); // 解析/校验失败由外层 catch 兜底
}

// 损坏兜底 fail-closed：备份原始 blob 后才重置，绝不静默丢弃用户数据
try {
  data = load();
} catch (e) {
  try { localStorage.setItem(BROKEN_KEY, localStorage.getItem(KEY) || ''); } catch (_) { /* 备份失败也继续重置 */ }
  console.error('本地数据损坏，原始数据已备份到 ' + BROKEN_KEY + '，已重置', e);
  data = defaultData();
  lastSavedJson = null;
}

function save(options = {}) {
  // 写前重读：识别其他标签页的写入并合并（本 tab 内存优先），防整库覆盖丢数据。
  // records 按日期并集、jobs 按 id 并集。已知取舍：另一 tab 的删除会被本 tab 旧数据
  // 合并复活——单用户低频场景，宁可复活可见数据也不静默丢失（importJSON 除外，见下）
  if (!options.bypassMerge) {
    try {
      const latest = localStorage.getItem(KEY);
      if (latest && latest !== lastSavedJson) {
        const merged = migrate(JSON.parse(latest));
        data.records = { ...merged.records, ...data.records };
        const ownIds = new Set(data.jobs.map((j) => j.id));
        data.jobs = [...data.jobs, ...merged.jobs.filter((j) => !ownIds.has(j.id))];
        if (!getJob(data.settings.defaultJobId)) {
          data.settings.defaultJobId = data.jobs[0] ? data.jobs[0].id : null;
        }
      }
    } catch (_) { /* 最新数据损坏时按本 tab 内存写入 */ }
  }
  try {
    persist();
  } catch (e) {
    // quota 超限或隐私模式：不吞掉，明确告知
    alert('保存失败：浏览器本地存储不可用或已满，请导出备份后清理浏览器数据');
    throw e;
  }
}

/** 实际写盘：失败直接抛错不弹窗，importJSON 需要自定义兜底（去壁纸重试） */
function persist() {
  const json = JSON.stringify(data);
  localStorage.setItem(KEY, json);
  lastSavedJson = json;
}

// 其他标签页写入时立即同步内存（storage 事件只在其他 tab 触发）
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || e.newValue == null) return;
  try {
    data = migrate(JSON.parse(e.newValue));
    lastSavedJson = e.newValue;
    document.dispatchEvent(new CustomEvent('slr:changed'));
  } catch (_) { /* 忽略无法解析的写入 */ }
});

// ---------- 记录 ----------

export function getRecord(dateKey) {
  return data.records[dateKey] || null;
}

export function allRecords() {
  return data.records;
}

/**
 * rec = { type:'hours'|'day'|'time', hours?, start?, end?, amount?,
 *         jobId, rate, income, overtime, note, settled }
 * rate/income 由调用方通过 computeIncome 快照写入
 */
export function saveRecord(dateKey, rec) {
  rec.note = String(rec.note == null ? '' : rec.note).slice(0, 200); // 与 sanitize 的长度约束同步，避免重载后被静默截断
  data.records[dateKey] = rec;
  if (rec.type !== 'day' && rec.hours) rememberDuration(rec.hours);
  save();
}

export function deleteRecord(dateKey) {
  delete data.records[dateKey];
  save();
}

/** 只改结算状态（统计页对账用），不触发时长档位学习等副作用 */
export function setSettled(dateKey, settled) {
  const rec = data.records[dateKey];
  if (!rec) return;
  rec.settled = !!settled;
  save();
}

export function computeIncome(rec) {
  if (rec.type === 'day') return round2(Number(rec.amount) || 0);
  return round2((Number(rec.hours) || 0) * (Number(rec.rate) || 0));
}

/** 时间型上下班时刻 → 小时数；end < start 视为跨零点；相等视为 0（防误操作算出 24h） */
export function timeToHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  if (diff === 0) return 0;
  return round2((diff < 0 ? diff + 1440 : diff) / 60);
}

// 常用时长档位：最近使用的排前面，最多 5 个
function rememberDuration(h) {
  const list = data.settings.recentDurations.filter((d) => d !== h);
  list.unshift(h);
  data.settings.recentDurations = list.slice(0, 5);
  save();
}

export function recentDurations() {
  return data.settings.recentDurations;
}

/** 最近一条记录（连打预填用） */
export function lastRecord() {
  const keys = Object.keys(data.records).sort();
  if (!keys.length) return null;
  const date = keys[keys.length - 1];
  return { date, rec: data.records[date] };
}

// ---------- 岗位 ----------

export function getJobs() {
  return data.jobs;
}

export function getJob(id) {
  return data.jobs.find((j) => j.id === id) || null;
}

export function addJob(name, rate) {
  // 数据层同样 clamp（importJSON 走 sanitize 已限，这里防直接调用绕过 UI 校验）
  const job = { id: 'job_' + Date.now().toString(36), name, rate: clampNum(rate, 0, 10000) };
  data.jobs.push(job);
  save();
  return job;
}

export function updateJob(id, { name, rate }) {
  const job = getJob(id);
  if (!job) return;
  if (name !== undefined) job.name = name;
  if (rate !== undefined) job.rate = round2(Number(rate) || 0);
  save();
}

export function setDefaultJob(id) {
  if (!getJob(id)) return; // 拒绝悬挂引用（岗位可能刚被删除）
  data.settings.defaultJobId = id;
  save();
}

export function deleteJob(id) {
  data.jobs = data.jobs.filter((j) => j.id !== id);
  if (!data.jobs.some((j) => j.id === data.settings.defaultJobId)) {
    data.settings.defaultJobId = data.jobs[0] ? data.jobs[0].id : null;
  }
  save();
}

export function getDefaultJobId() {
  return data.settings.defaultJobId;
}

// ---------- 打卡设置 / 外观 ----------

export function getQuickFill() {
  return data.settings.quickFill;
}

export function setQuickFill(patch) {
  const qf = data.settings.quickFill;
  if (patch.mode !== undefined) qf.mode = patch.mode === 'custom' ? 'custom' : 'last';
  if (patch.hours !== undefined) {
    const h = clampNum(patch.hours, 0.5, 24);
    if (h) qf.hours = h;
  }
  if (patch.customHours !== undefined) {
    // 自定义时长组：过滤非法/去重/上限 5，供打卡弹窗 chips 覆盖「最近记录」档位
    qf.customHours = [...new Set(
      (Array.isArray(patch.customHours) ? patch.customHours : [])
        .map(Number).filter((n) => Number.isFinite(n) && n >= 0.5 && n <= 24)
    )].slice(0, 5);
  }
  save();
}

export function getWallpaper() {
  return data.settings.wallpaper;
}

/** 壁纸形状校验：非法/超限 → null；opacity/fit 收敛到合法域 */
function sanitizeWallpaper(w) {
  if (w && typeof w === 'object'
    && typeof w.dataUrl === 'string'
    && w.dataUrl.startsWith('data:image/')
    && w.dataUrl.length <= 3000000) {
    return {
      dataUrl: w.dataUrl,
      opacity: clampNum(w.opacity, 0, 1),
      fit: ['cover', 'contain', 'stretch'].includes(w.fit) ? w.fit : 'cover',
    };
  }
  return null;
}

/** w = null 或 { dataUrl, opacity, fit }；写入前统一 sanitize */
export function setWallpaper(w) {
  data.settings.wallpaper = sanitizeWallpaper(w);
  save();
}

// ---------- 统计 ----------

function monthPrefix(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-`;
}

/** 半月分期：1–15 日 = 1（上半月），16 日–月末 = 2（下半月）；期不跨月 */
export function periodOf(dateKey) {
  const day = Number(String(dateKey).slice(8, 10));
  return day > 0 && day <= 15 ? 1 : 2;
}

export function monthKeys(year, month) {
  const prefix = monthPrefix(year, month);
  return Object.keys(data.records).filter((k) => k.startsWith(prefix)).sort();
}

export function periodKeys(year, month, half) {
  return monthKeys(year, month).filter((k) => periodOf(k) === half);
}

/** 按日期集合聚合；monthSummary / periodSummary 共用，保证统计口径一致 */
function summarize(keys) {
  // perJob 用无原型对象：jobId 是外部可控字符串，普通 {} 在 __proto__ / constructor 键上
  // 会拿到继承属性并写脏 Object.prototype / Object，且岗位明细少算
  const sum = { hours: 0, income: 0, settled: 0, days: 0, count: keys.length, settledCount: 0, perJob: Object.create(null) };
  for (const k of keys) {
    const rec = data.records[k];
    if (!rec) continue;
    sum.hours += rec.hours || 0;
    sum.income += rec.income || 0;
    if (rec.settled) { sum.settled += rec.income || 0; sum.settledCount += 1; }
    sum.days += 1;
    const pj = (sum.perJob[rec.jobId] = sum.perJob[rec.jobId] || { hours: 0, income: 0 });
    pj.hours += rec.hours || 0;
    pj.income += rec.income || 0;
  }
  sum.hours = round2(sum.hours);
  sum.income = round2(sum.income);
  sum.settled = round2(sum.settled);
  sum.unsettled = round2(sum.income - sum.settled);
  return sum;
}

/** month: 1-12；返回结构保持兼容（hours/income/settled/unsettled/days/perJob） */
export function monthSummary(year, month) {
  return summarize(monthKeys(year, month));
}

/** 半月模式：某期汇总 */
export function periodSummary(year, month, half) {
  return summarize(periodKeys(year, month, half));
}

// ---------- 结算模式与批量结算 ----------

export function getSettlementMode() {
  return data.settings.settlementMode === 'half-month' ? 'half-month' : 'record';
}

export function setSettlementMode(mode) {
  data.settings.settlementMode = mode === 'half-month' ? 'half-month' : 'record';
  save();
}

/** 找本月工时最多的一周（7 天为一周，按日期自然周分组）；返回 [{date, label, hours, income}] */
export function busiestWeek(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const weeks = {};
  for (const [key, rec] of Object.entries(data.records)) {
    if (!key.startsWith(prefix) || !rec || rec.type !== 'hours') continue;
    const day = Number(key.slice(8, 10));
    if (!(day >= 1 && day <= 31)) continue;
    const d = new Date(year, month - 1, day);
    const dow = d.getDay(); // 0=周日
    const monday = day - ((dow + 6) % 7);
    const wk = String(Math.max(1, monday)).padStart(2, '0');
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push({ date: key, day, hours: rec.hours || 0, income: rec.income || 0 });
  }
  let best = null;
  for (const [wk, days] of Object.entries(weeks)) {
    const total = days.reduce((sum, d) => sum + d.hours, 0);
    if (!best || total > best.total) best = { wk, days, total, income: days.reduce((s, d) => s + d.income, 0) };
  }
  if (!best) return null;
  const labels = ['日', '一', '二', '三', '四', '五', '六'];
  const byDow = new Map(best.days.map((d) => [new Date(year, month - 1, d.day).getDay(), d]));
  return {
    days: labels.map((label, dow) => {
      const r = byDow.get(dow);
      return { label, hours: r ? r.hours : 0, income: r ? r.income : 0 };
    }),
    totalHours: round2(best.total),
    totalIncome: round2(best.income),
    daysCount: best.days.length,
  };
}

/** 批量置位：只写一次盘；返回实际改动条数 */
function batchSettle(keys, settled) {
  let changed = 0;
  for (const k of keys) {
    const rec = data.records[k];
    if (rec && !!rec.settled !== !!settled) { rec.settled = !!settled; changed += 1; }
  }
  if (changed) save();
  return changed;
}

/** 半月模式：整期结算 / 取消（1–15 或 16–月末） */
export function setSettledForPeriod(year, month, half, settled) {
  return batchSettle(periodKeys(year, month, half), settled);
}

/** 按记录模式：当月全部结算 / 取消（不动历史月份，符合统计页语境） */
export function setSettledForMonth(year, month, settled) {
  return batchSettle(monthKeys(year, month), settled);
}

// ---------- 原版 App Excel 导入（行由 xlsx.js 解析，合并逻辑归数据层） ----------

// rows: [{date, hours, jobName, rate, income, overtime, note}]；按日期合并覆盖，
// 岗位按名匹配（缺则按 Excel 时薪新建）；income 统一按 hours×rate 快照重算，与 Excel 不符时给出警告。
export function importXlsxRows(rows) {
  const warnings = [];
  let imported = 0;
  let overwritten = 0;
  let jobsCreated = 0;
  const jobsCreatedNames = [];
  for (const row of rows) {
    if (!isValidDateKey(row.date)) { warnings.push(`跳过（日期无效）：${row.date}`); continue; }
    const hours = clampNum(row.hours, 0, 24);
    if (!(hours > 0)) { warnings.push(`跳过（工时无效）：${row.date}`); continue; }
    let job = data.jobs.find((j) => j.name === row.jobName);
    if (!job) {
      job = { id: 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(row.jobName || '未命名').slice(0, 50), rate: clampNum(row.rate, 0, 10000) };
      data.jobs.push(job);
      jobsCreated++;
      jobsCreatedNames.push(job.name);
      warnings.push(`新建岗位：${job.name}（${job.rate}元/时）`);
    }
    const rec = { type: 'hours', hours, jobId: job.id, rate: job.rate, overtime: !!row.overtime };
    rec.income = round2(rec.hours * rec.rate);
    // Excel 声明收入 vs 重算值差异告警（CLAUDE.md 规格的另一半：只对已有记录告警不够）
    const excelIncome = Number(row.income);
    if (Number.isFinite(excelIncome) && Math.abs(excelIncome - rec.income) > 0.01) {
      warnings.push(`${row.date}：Excel 记载收入 ${excelIncome} 与重算值 ${rec.income}（${rec.hours}h × ${rec.rate}元/时）不一致，已按重算值入库`);
    }
    const prev = data.records[row.date];
    if (prev && Math.abs((prev.income || 0) - rec.income) > 0.01) {
      warnings.push(`${row.date}：收入与已有记录不一致（${prev.income} → ${rec.income}），以 Excel 为准`);
    }
    rec.note = row.note ? String(row.note).slice(0, 200) : (prev ? prev.note : '');
    rec.settled = prev ? prev.settled : false;
    if (prev) overwritten++;
    data.records[row.date] = rec;
    imported++;
  }
  if (!data.jobs.some((j) => j.id === data.settings.defaultJobId) && data.jobs[0]) {
    data.settings.defaultJobId = data.jobs[0].id;
  }
  if (imported) save();
  return { imported, overwritten, jobsCreated, jobsCreatedNames, warnings };
}

// ---------- 导入导出 ----------

export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

/**
 * 解析备份文本：尽量耐扛常见传输损伤（BOM/首尾垃圾/改格式），失败时给出可定位的提示。
 * 各类精确报错：空文件 / 网页(HTML) / gzip 压缩包 / CSV 表格 / 截断——都指向下一步该做什么。
 */
function parseBackupText(text) {
  let t = String(nz(text));
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // UTF-8 BOM（编辑器/传输环节常见）
  t = t.trim();
  if (!t) throw new Error('备份文件是空的，请重新导出');
  if (t.charCodeAt(0) === 0x1f && t.charCodeAt(1) === 0x8b)
    throw new Error('这是 gzip 压缩包，先解压出里面的 JSON 再导入');
  if (t.startsWith('<'))
    throw new Error('选到的文件是网页而不是备份（下载被存成了预览页），请重新导出 JSON 备份');
  try {
    return JSON.parse(t);
  } catch (e) {
    // 恢复：文件前后被附加了垃圾时，截取首个 { 到最后一个 } 再试
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start + 1) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch (_) { /* 走统一报错 */ }
    }
    if (/^日期\s*,/.test(t) || /,已结算\s*,?/.test(t.slice(0, 200)))
      throw new Error('选到的是 CSV 表格，不是 JSON 备份——请用「导出备份(JSON)」导出的文件');
    const head = t.slice(0, 40).replace(/\s+/g, ' ');
    throw new Error(
      `备份文件内容无法解析（开头是「${head}」）。可能是传输截断/改写——把这个文件直接发给助手可以帮你修复`,
    );
  }
}

/**
 * 全量恢复（覆盖现有数据），畸形数据在 migrate 的校验层收敛。
 * 返回 { records, wallpaperDropped }：存储空间不足时自动去掉壁纸重试（记录保住优先），
 * wallpaperDropped=true 表示备份里的背景图没能一并恢复。
 */
export function importJSON(text) {
  const parsed = parseBackupText(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) {
    throw new Error('不是本工具导出的备份文件');
  }
  const prevData = data;
  data = migrate(parsed);
  // bypassMerge：全量恢复契约——不与现有数据合并，备份里删掉的就是删掉
  try {
    persist();
    return { records: Object.keys(data.records).length, wallpaperDropped: false };
  } catch (e) {
    // 壁纸 dataURL 是备份里最大的字段，quota 兜底：去掉壁纸保记录
    if (data.settings && data.settings.wallpaper) {
      data.settings.wallpaper = null;
      try {
        persist();
        return { records: Object.keys(data.records).length, wallpaperDropped: true };
      } catch (_) { /* 仍超限，走统一失败 */ }
    }
    data = prevData; // setItem 失败不会改写 localStorage，内存回滚即与存储一致
    throw new Error('浏览器存储空间不足，导入失败：请先清理浏览器数据或换设备后重试');
  }
}

function csvField(v) {
  let s = String(nz(v));
  // 公式注入中和：= + - @ 或制表符/回车开头的字段，Excel 打开 CSV 时会当公式求值，前置单引号强制为文本
  if (/^[=+\-\t\r@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function exportCSV() {
  const head = '日期,类型,时长h,开始,结束,金额,收入,岗位,时薪,加班,备注,已结算';
  const rows = Object.keys(data.records)
    .sort()
    .map((k) => {
      const r = data.records[k];
      const job = getJob(r.jobId);
      return [
        k,
        r.type,
        nz(r.hours),
        nz(r.start),
        nz(r.end),
        nz(r.amount),
        r.income,
        job ? job.name : '(已删除岗位)',
        nz(r.rate),
        r.overtime ? '是' : '',
        r.note || '',
        r.settled ? '是' : '',
      ].map(csvField).join(',');
    });
  return '\ufeff' + [head, ...rows].join('\n');
}

/**
 * 批量粘贴导入，每行一条：
 *   2026-11-01 2h 三楼取餐      （工时型，岗位可选，缺省用默认岗位）
 *   2026-11-01 2.5              （h/小时/时可省略）
 *   2026-11-05 日结 150         （日结型）
 * 同日期覆盖，返回 { imported, overwritten, warnings: [] }
 */
export function importBatch(text) {
  const warnings = [];
  let imported = 0;
  let overwritten = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (!m) {
      warnings.push(`跳过（格式不对）：${line}`);
      continue;
    }
    const dateKey = m[1];
    if (!isValidDateKey(dateKey)) {
      warnings.push(`跳过（日期无效）：${line}`);
      continue;
    }
    const rest = m[2];

    let rec = null;
    const dayMatch = rest.match(/^日结\s+(\d+(?:\.\d+)?)\s*(?:元)?\s*(.*)$/);
    const hoursMatch = rest.match(/^(\d+(?:\.\d+)?)\s*(?:h|H|小时|时)?\s*(.*)$/);

    if (dayMatch) {
      const amount = Number(dayMatch[1]);
      if (!(amount >= 0 && amount <= 1000000)) {
        warnings.push(`跳过（日结金额需在 0~1000000）：${line}`);
        continue;
      }
      const job = getJob(data.settings.defaultJobId) || data.jobs[0] || null;
      if (job) {
        rec = { type: 'day', amount, jobId: job.id, rate: 0 };
      } else {
        // 日结金额本身就是收入：无岗位时按空白岗位落库不丢行；工时型无时薪来源仍跳过
        rec = { type: 'day', amount, jobId: '', rate: 0 };
        warnings.push(`无岗位，已按空白岗位记录：${line}`);
      }
    } else if (hoursMatch) {
      const hours = Number(hoursMatch[1]);
      if (!(hours > 0 && hours <= 24)) {
        warnings.push(`跳过（时长需在 0~24h）：${line}`);
        continue;
      }
      const jobName = hoursMatch[2].trim();
      let job = jobName ? data.jobs.find((j) => j.name === jobName) : null;
      if (!job) {
        // 岗位名缺省或不匹配时回退默认岗位，默认岗也没了再兜底第一个岗位（与日结分支对称）
        job = getJob(data.settings.defaultJobId) || data.jobs[0] || null;
        if (jobName) warnings.push(`岗位「${jobName}」不存在，已用默认岗位：${line}`);
      }
      if (!job) {
        warnings.push(`跳过（无可用岗位）：${line}`);
        continue;
      }
      rec = { type: 'hours', hours, jobId: job.id, rate: job.rate };
    } else {
      warnings.push(`跳过（无法识别）：${line}`);
      continue;
    }

    rec.overtime = false;
    // 同日覆盖：结算状态与备注是外部事实，继承旧记录，不随导入重置
    const prev = data.records[dateKey];
    rec.note = prev ? prev.note : '';
    rec.settled = prev ? prev.settled : false;
    rec.income = computeIncome(rec);
    if (prev) overwritten += 1;
    data.records[dateKey] = rec;
    imported += 1;
  }
  save();
  return { imported, overwritten, warnings };
}

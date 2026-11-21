// stats.js — 统计页：等大并列汇总卡、按月/按期切换、岗位明细、逐日列表 + 单条/批量结算
import {
  getJob, getRecord, setSettled, allRecords, fmtHours1, fmtNum, esc,
  setSettledForPeriod, setSettledForMonth,
} from './store.js';
import {
  summaryHtml, settleButtonHtml, scopeKeys, scopeSummary, getScope, setPeriodHalf,
} from './cards.js';

const root = document.getElementById('view-stats');
let statYear = null;
let statMonth = null; // 1-12
let goEdit = null; // 点列表记录 → 跳日历并打开编辑

export function initStats(cb) {
  goEdit = cb;
  root.addEventListener('click', onClick);
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'prev-month') shiftMonth(-1);
  else if (act === 'next-month') shiftMonth(1);
  else if (act === 'set-half') { setPeriodHalf(Number(el.dataset.half)); renderStats(); }
  else if (act === 'toggle-settle') {
    const rec = getRecord(el.dataset.date);
    if (rec) {
      // 只改结算状态，不走 saveRecord（避免污染常用时长档位）
      setSettled(el.dataset.date, !rec.settled);
      document.dispatchEvent(new CustomEvent('slr:changed'));
    }
  } else if (act === 'edit-rec') goEdit(el.dataset.date);
  else if (act === 'settle-all') settleAll(el);
}

/** 批量结算属覆盖类操作，必须二次确认；范围按当前模式（整期 / 当月） */
function settleAll(el) {
  const sc = getScope(statYear, statMonth);
  const s = scopeSummary(statYear, statMonth);
  if (!s.count) { alert('当前范围内没有记录'); return; }
  const done = s.settledCount === s.count;
  const msg = done
    ? `取消「${sc.range}」的结算？将把 ${s.count} 条记录（${fmtNum(s.income)} 元）改回未结算。确认？`
    : `确认结算「${sc.range}」？将把 ${s.count} 条记录（${fmtNum(s.income)} 元）全部标记为已结算。确认？`;
  if (!confirm(msg)) return;
  if (sc.mode === 'half-month') setSettledForPeriod(statYear, statMonth, sc.half, !done);
  else setSettledForMonth(statYear, statMonth, !done);
  document.dispatchEvent(new CustomEvent('slr:changed'));
}

function shiftMonth(delta) {
  statMonth += delta;
  if (statMonth === 0) { statMonth = 12; statYear -= 1; }
  if (statMonth === 13) { statMonth = 1; statYear += 1; }
  renderStats();
}

export function renderStats() {
  if (!statYear) {
    const now = new Date();
    statYear = now.getFullYear();
    statMonth = now.getMonth() + 1;
  }
  const sc = getScope(statYear, statMonth);
  const keys = scopeKeys(statYear, statMonth, Object.keys(allRecords()));

  // 岗位明细与列表共用当前范围（半月模式只统计本期）
  // 与 store.js::summarize 一致：无原型对象，防止 __proto__ / constructor 型 jobId 污染全局
  const perJob = Object.create(null);
  for (const k of keys) {
    const rec = getRecord(k);
    if (!rec) continue;
    const pj = (perJob[rec.jobId] = perJob[rec.jobId] || { hours: 0, income: 0 });
    pj.hours += rec.hours || 0;
    pj.income += rec.income || 0;
  }
  const perJobRows = Object.entries(perJob)
    .map(([id, pj]) => {
      const job = getJob(id);
      const name = job ? esc(job.name) : (id === '' ? '自定义' : '(已删除岗位)');
      return `<div class="pj-row"><span>${name}</span><span>${fmtHours1(pj.hours)}h</span><span>${fmtNum(pj.income)}元</span></div>`;
    })
    .join('');

  root.innerHTML = `
    <div class="stats-head">
      <button class="icon-btn" data-act="prev-month" aria-label="上个月">‹</button>
      <h1>${statYear}年${statMonth}月</h1>
      <button class="icon-btn" data-act="next-month" aria-label="下个月">›</button>
    </div>
    ${summaryHtml(statYear, statMonth)}
    ${settleButtonHtml(statYear, statMonth)}
    ${perJobRows ? `<div class="sec"><h2>岗位明细</h2><div class="pj-row pj-head"><span>岗位</span><span>工时</span><span>收入</span></div>${perJobRows}</div>` : ''}
    <div class="sec"><h2>${sc.mode === 'half-month' ? (sc.half === 1 ? '上半月' : '下半月') : '本月'}记录</h2>${listHtml(keys)}</div>`;
}

function listHtml(keys) {
  if (!keys.length) return '<div class="empty">本期暂无记录</div>';
  const typeLabel = { hours: '工时', day: '日结', time: '时间' };
  return keys
    .slice()
    .reverse()
    .map((k) => {
      const rec = getRecord(k);
      const job = getJob(rec.jobId);
      const jobLabel = job ? esc(job.name) : (rec.jobId === '' ? '自定义' : '岗位已删');
      const detail = rec.type === 'day'
        ? `日薪 ${fmtNum(rec.amount)}元`
        : `${fmtHours1(rec.hours)}h · ${jobLabel}${rec.overtime ? ' · 加班' : ''}${rec.note ? ` · ${esc(rec.note)}` : ''}`;
      return `
        <div class="rec-row">
          <div class="rec-main" data-act="edit-rec" data-date="${k}">
            <span class="rec-date">${k.slice(5)}</span>
            <span class="rec-type t-${rec.type}">${typeLabel[rec.type] || rec.type}</span>
            <span class="rec-info">${detail}</span>
          </div>
          <span class="rec-income">${fmtNum(rec.income)}元</span>
          <button class="settle-btn${rec.settled ? ' on' : ''}" data-act="toggle-settle" data-date="${k}">${rec.settled ? '已结算' : '未结算'}</button>
        </div>`;
    })
    .join('');
}

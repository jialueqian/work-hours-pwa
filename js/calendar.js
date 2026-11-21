// calendar.js — 月历视图：周一为首列、节气、等大并列汇总卡、半月分期边界、今日高亮
import { getRecord, todayKey, fmtHours1, fmtNum, esc, periodOf, getSettlementMode } from './store.js';
import { getTerm } from './terms.js';
import { summaryHtml, setPeriodHalf, getPeriodHalf } from './cards.js';

const root = document.getElementById('view-calendar');
let calYear = null;
let calMonth = null;
let onOpenDay = null;

export function initCalendar(cb) {
  onOpenDay = cb;
  root.addEventListener('click', onClick);
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  switch (el.dataset.act) {
    case 'prev-month': shiftMonth(-1); break;
    case 'next-month': shiftMonth(1); break;
    case 'goto-today': { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth() + 1; renderCalendar(); break; }
    case 'open-day': onOpenDay(el.dataset.date); break;
    case 'set-half': setPeriodHalf(Number(el.dataset.half)); renderCalendar(); break;
    case 'flip-hero': el.classList.toggle('flipped'); break;
  }
}

// 键盘可达：聚焦卡片后回车/空格翻转（与点击同一语义）
root.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('hero-flip')) {
    e.preventDefault();
    e.target.classList.toggle('flipped');
  }
});

function shiftMonth(delta) {
  calMonth += delta;
  if (calMonth === 0) { calMonth = 12; calYear -= 1; }
  if (calMonth === 13) { calMonth = 1; calYear += 1; }
  renderCalendar();
}

/** 跳转到指定月份（统计页点记录跳日历时用） */
export function gotoMonth(year, month) {
  calYear = year;
  calMonth = month;
  renderCalendar();
}

export function renderCalendar() {
  if (!calYear) {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth() + 1;
  }
  root.innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" data-act="prev-month" aria-label="上个月">‹</button>
      <h1>${calYear}年${calMonth}月</h1>
      <button class="icon-btn" data-act="next-month" aria-label="下个月">›</button>
      <button class="today-btn" data-act="goto-today">今天</button>
    </div>
    ${summaryHtml(calYear, calMonth)}
    <div class="cal-grid">
      ${['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((w) => `<div class="wd">${w}</div>`).join('')}
      ${gridCells()}
    </div>`;
}

function gridCells() {
  const first = new Date(calYear, calMonth - 1, 1);
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一为首列的偏移
  const today = todayKey();
  const mode = getSettlementMode();
  const half = getPeriodHalf(calYear, calMonth);
  let html = '';
  for (let i = 0; i < lead; i++) html += '<div class="day-blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = getRecord(key);
    const term = getTerm(calYear, calMonth, d);
    let cls = 'day-cell';
    if (mode === 'half-month' && periodOf(key) === half) cls += ' cur';
    if (mode === 'half-month' && d === 16) cls += ' boundary';
    if (key === today) cls += ' today';
    html += `
      <div class="${cls}" data-act="open-day" data-date="${key}">
        <div class="day-top">
          <span class="day-num">${d}</span>
          ${mode === 'half-month' && d === 16 ? '<span class="period-flag">下半月起</span>' : ''}
          ${term && !(mode === 'half-month' && d === 16) ? `<span class="term">${term}</span>` : ''}
        </div>
        ${rec ? blocksHtml(rec) : ''}
      </div>`;
  }
  const total = lead + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let i = 0; i < trail; i++) html += '<div class="day-blank"></div>';
  return html;
}

function blocksHtml(rec) {
  const parts = [];
  if (rec.type === 'day') {
    parts.push('<span class="rec-blk day-pay">日结</span>');
  } else {
    parts.push(`<span class="rec-blk hours">${fmtHours1(rec.hours)}h</span>`);
  }
  if (rec.income) {
    parts.push(`<span class="rec-blk income${rec.settled ? ' settled' : ''}">${fmtNum(rec.income)}</span>`);
  }
  return `<div class="day-blocks">${parts.join('')}</div>`;
}

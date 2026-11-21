// cards.js — 统计页与月历页共用的汇总卡区（v6 定稿视觉）
// 工资与工时等大并列同一张卡；分期切换条；三张小卡；批量结算按钮（仅统计页使用）
// 只调用 store.js 的公开 API，不碰 localStorage、不生成事件绑定（由各视图容器委托）
import {
  getSettlementMode, monthSummary, periodSummary, fmtNum, fmtHours1, esc,
  periodOf, todayKey, busiestWeek,
} from './store.js';

let periodHalf = null; // 当前查看的期：1 上半月 / 2 下半月；calendar 与 stats 共享

/** 首次进入按「今天所在期」定位；查看历史月份默认上半月，之后保持用户选择 */
export function getPeriodHalf(year, month) {
  if (periodHalf === null) {
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;
    const today = todayKey();
    periodHalf = today.startsWith(prefix) ? periodOf(today) : 1;
  }
  return periodHalf;
}

export function setPeriodHalf(h) {
  periodHalf = h === 2 ? 2 : 1;
}

export function getScope(year, month) {
  const mode = getSettlementMode();
  const half = getPeriodHalf(year, month);
  if (mode !== 'half-month') return { mode, half, label: `全月 · ${month} 月`, range: `${month} 月` };
  return {
    mode, half,
    label: half === 1 ? '本期 · 上半月 1–15 日' : '本期 · 下半月 16 日–月末',
    range: half === 1 ? '上半月 1–15 日' : '下半月 16 日–月末',
  };
}

/** 当前显示范围（半月模式按期、按记录模式按全月）的汇总 */
export function scopeSummary(year, month) {
  const sc = getScope(year, month);
  return sc.mode === 'half-month' ? periodSummary(year, month, sc.half) : monthSummary(year, month);
}

/** 当前显示范围内的日期 key 列表（供 stats.js 过滤明细） */
export function scopeKeys(year, month, allKeys) {
  const sc = getScope(year, month);
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return allKeys
    .filter((k) => k.startsWith(prefix) && (sc.mode !== 'half-month' || periodOf(k) === sc.half))
    .sort();
}

function statusText(s) {
  if (!s.count) return '本期暂无记录';
  if (s.settledCount === s.count) return '已结算';
  if (s.settledCount) return `部分结算 ${s.settledCount}/${s.count}`;
  return '未结算';
}

/** 卡区 HTML：等大并列卡 + 分期切换（半月模式）+ 三小卡 */
export function summaryHtml(year, month) {
  const sc = getScope(year, month);
  const s = scopeSummary(year, month);
  const st = statusText(s);
  const settledAll = s.count > 0 && s.settledCount === s.count;
  const avg = s.count ? fmtHours1(s.hours / s.count) : '0';

  const front = '<div class="hero-face hero-front">' +
    `<div class="hero-eq-top"><span class="hero-eq-label">${esc(sc.label)}</span>` +
    `<span class="pill${settledAll ? ' on' : ''}">${esc(st)}</span></div>` +
    '<div class="hero-eq-grid">' +
      `<div class="hero-eq-col"><div class="hero-eq-k">工资</div><span class="hero-eq-v">${fmtNum(s.income)}</span><span class="hero-eq-u">元</span></div>` +
      `<div class="hero-eq-col"><div class="hero-eq-k">工时</div><span class="hero-eq-v">${fmtHours1(s.hours)}</span><span class="hero-eq-u">h</span></div>` +
    '</div>' +
    `<div class="hero-eq-foot">${s.count} 条记录 · 日均 ${avg}h <span class="flip-hint" aria-hidden="true">↻</span></div>` +
  '</div>';

  const back = '<div class="hero-face hero-back">' + weekBandFace(year, month) + '</div>';

  let html = `<div class="hero-flip" data-act="flip-hero" role="button" tabindex="0" aria-label="翻转汇总卡查看最忙的一周">` +
    `<div class="hero-flip-inner">${front}${back}</div></div>`;

  if (sc.mode === 'half-month') {
    const s1 = periodSummary(year, month, 1);
    const s2 = periodSummary(year, month, 2);
    html += '<div class="period-seg">' +
      `<button data-act="set-half" data-half="1" class="${sc.half === 1 ? 'on' : ''}">上半月 1–15<span class="sub">${fmtNum(s1.income)} 元 · ${esc(statusText(s1))}</span></button>` +
      `<button data-act="set-half" data-half="2" class="${sc.half === 2 ? 'on' : ''}">下半月 16–月末<span class="sub">${fmtNum(s2.income)} 元 · ${esc(statusText(s2))}</span></button>` +
    '</div>';
  }

  html += '<div class="mini-grid">' +
    `<div class="mini"><div class="v">${s.count}</div><div class="k">出勤天数</div></div>` +
    `<div class="mini"><div class="v">${fmtNum(s.settled)}</div><div class="k">已结算(元)</div></div>` +
    `<div class="mini"><div class="v">${fmtNum(s.unsettled)}</div><div class="k">未结算(元)</div></div>` +
  '</div>';
  return html;
}

/** 批量结算按钮（仅统计页）：文案与范围按模式区分，确认信息写进 data-* */
export function settleButtonHtml(year, month) {
  const sc = getScope(year, month);
  const s = scopeSummary(year, month);
  const done = s.count > 0 && s.settledCount === s.count;
  const label = sc.mode === 'half-month' ? '整期结算' : '一键全部结算';
  const cancel = sc.mode === 'half-month' ? '取消整期结算' : '取消全部结算';
  return `<button class="btn-primary btn-block${done ? ' done' : ''}" data-act="settle-all"` +
    ` data-range="${esc(sc.range)}" data-count="${s.count}" data-money="${fmtNum(s.income)}" data-done="${done ? '1' : '0'}">` +
    (done ? cancel : `${label} · ${s.count} 条 / ${fmtNum(s.income)} 元`) + '</button>';
}

/** 翻转卡背面：本月工时最多的一周（周一起算），每天的工时画成柱高。
 * 无工时记录时给诚实占位，不画空柱。 */
function weekBandFace(year, month) {
  const w = busiestWeek(year, month);
  let top = '<div class="wb-head"><span class="wb-title">最忙的一周</span>' +
    '<span class="pill">点卡片返回 ↻</span></div>';
  if (!w || !w.totalHours) {
    return top + '<div class="wb-empty">本月还没有工时记录<br>打一次卡，这里会显示最忙的一周</div>';
  }
  const max = Math.max(...w.days.map((d) => d.hours), 0.5);
  const bars = w.days.map((d) => {
    const h = d.hours > 0 ? Math.max(4, Math.round(d.hours / max * 72)) : 3;
    return `<div class="wb-col${d.hours ? '' : ' off'}"><span class="wb-val">${d.hours ? fmtHours1(d.hours) : ''}</span>` +
      `<div class="wb-bar" style="height:${h}px"></div><span class="wb-day">${d.label}</span></div>`;
  }).join('');
  return top +
    `<div class="wb-total">${fmtHours1(w.totalHours)}<small>h</small> · ${fmtNum(w.totalIncome)}<small>元</small>` +
    `<span class="wb-days">${w.daysCount} 天有记录</span></div>` +
    `<div class="wb-bars">${bars}</div>`;
}

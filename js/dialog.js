// dialog.js — 打卡弹窗：三类型（工时/日结/时间）+ 三通道时长输入（chips / ±0.5 / 直接输入）+ 连打预填 + 空白自定义岗位
// 槽点优化核心：30min 不再需要滚轮，点 chip 或 ±0.5 即可
import {
  getRecord, saveRecord, deleteRecord, getJobs, getJob, getDefaultJobId,
  computeIncome, timeToHours, recentDurations, lastRecord, fmtHours, esc, getQuickFill,
} from './store.js';

const dlg = document.getElementById('punch-dialog');
let editingDate = null; // 正在编辑的日期 key

// <dialog> 兼容：老 Safari（<15.4）与部分老国产内核不实现 dialog，元素退化为 inline 未知元素
// polyfill 最小集：open 属性双向同步 + showModal/close；定位由我们的 bottom-sheet CSS 承担
if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) {
  Object.defineProperty(HTMLDialogElement.prototype, 'open', {
    get() { return this.hasAttribute('open'); },
    set(v) { if (v) this.setAttribute('open', ''); else this.removeAttribute('open'); },
    configurable: true,
  });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
}
let hasExisting = false;
let draft = null; // 弹窗内草稿 { type,hours,amount,start,end,jobId,overtime,note,settled }
let baseJobId = null; // 编辑前记录的原岗位（判断是否换岗）
let baseRate = null; // 编辑前记录的时薪快照（day 型记录 rate 恒 0，不快照，切型时用岗位现价）
let baseSnapshot = null; // 打开弹窗时的记录快照（检测其他窗口的并发修改）

export function initDialog() {
  dlg.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'set-type': syncFromInputs(); draft.type = el.dataset.type; renderTabs(); renderBody(); updateCustomRateRow(); updatePreview(); break;
      case 'dur-dec': stepDuration(-0.5); break;
      case 'dur-inc': stepDuration(0.5); break;
      case 'chip': {
        const h = Number(el.dataset.h);
        document.getElementById('dlg-hours').value = h;
        draft.hours = h;
        updatePreview();
        break;
      }
      case 'cancel': dlg.close(); break;
      case 'confirm': confirmSave(); break;
      case 'del': confirmDelete(); break;
    }
  });
  // 任意输入实时刷新收入预览
  dlg.addEventListener('input', () => { syncFromInputs(); updatePreview(); });
  dlg.addEventListener('change', () => { syncFromInputs(); updateCustomRateRow(); updatePreview(); });
}

/** 与当前时长一致的 chip 高亮 */
function syncChips() {
  document.querySelectorAll('.dur-chips button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.h) === Number(draft.hours));
  });
}

/** 打开某天的打卡弹窗；无记录时用最近一次记录预填（连打） */
export function openPunchDialog(dateKey) {
  editingDate = dateKey;
  const existing = getRecord(dateKey);
  let base = existing;
  if (!base) {
    const qf = getQuickFill();
    if (qf && qf.mode === 'custom' && qf.hours > 0) {
      // 自定义连打：预填自定义时长组的第一档（无自定义组时回退单值），岗位走默认岗位
      const customList = qf.customHours && qf.customHours.length ? qf.customHours : null;
      base = { type: 'hours', hours: customList ? customList[0] : qf.hours };
    } else {
      const last = lastRecord();
      if (last) base = { ...last.rec, overtime: false, settled: false, note: '' };
    }
  }
  draft = {
    type: base ? base.type : 'hours',
    hours: base && base.hours !== undefined ? base.hours : '',
    amount: base && base.amount !== undefined ? base.amount : '',
    start: base ? base.start || '' : '',
    end: base ? base.end || '' : '',
    jobId: (base && base.jobId) || getDefaultJobId() || (getJobs()[0] ? getJobs()[0].id : ''),
    overtime: !!(base && base.overtime),
    note: base ? base.note || '' : '',
    settled: !!(base && base.settled),
    // 空白自定义岗位的本条时薪（编辑空白记录时预填快照值）
    customRate: existing && !existing.jobId && existing.type !== 'day' && Number.isFinite(existing.rate) ? existing.rate : '',
  };
  hasExisting = !!existing;
  baseJobId = existing ? existing.jobId : null;
  baseRate = existing && existing.type !== 'day' && Number.isFinite(existing.rate) ? existing.rate : null;
  baseSnapshot = existing ? JSON.stringify(existing) : null;
  // 连打预填的岗位已不存在时回退默认岗位（编辑态保留原值，弹窗里显示占位提示）
  if (!existing && draft.jobId && !getJob(draft.jobId)) {
    draft.jobId = getDefaultJobId() || (getJobs()[0] ? getJobs()[0].id : '');
  }
  dlg.innerHTML = `
    <div class="dlg-wrap">
      <div class="dlg-head"><h2>${dateKey} 工时打卡</h2></div>
      <div class="dlg-tabs" id="dlg-tabs"></div>
      <div class="dlg-body" id="dlg-body"></div>
      <div class="dlg-row">
        <label>岗位</label>
        <select id="dlg-job">${jobOptions()}</select>
      </div>
      <div class="dlg-row" id="dlg-custom-rate-row" hidden>
        <label>时薪</label>
        <input id="dlg-custom-rate" type="number" min="0" max="10000" step="0.5" inputmode="decimal" placeholder="本条时薪(元/时)" value="${draft.customRate}">
      </div>
      <div class="dlg-row">
        <label>是否加班</label>
        <label class="switch"><input type="checkbox" id="dlg-overtime" ${draft.overtime ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="dlg-row">
        <label>备注</label>
        <input id="dlg-note" placeholder="请输入" value="${esc(draft.note)}">
      </div>
      <div class="dlg-row">
        <label>已结算</label>
        <label class="switch"><input type="checkbox" id="dlg-settled" ${draft.settled ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="dlg-preview" id="dlg-preview"></div>
      <div class="dlg-actions">
        ${hasExisting ? '<button class="btn-danger" data-act="del">删除</button>' : ''}
        <button class="btn-ghost" data-act="cancel">取消</button>
        <button class="btn-primary" data-act="confirm">确认</button>
      </div>
    </div>`;
  renderTabs();
  renderBody();
  updateCustomRateRow();
  updatePreview();
  if (!dlg.open) dlg.showModal();
}

function jobOptions() {
  const jobs = getJobs();
  const deletedPlaceholder = !!draft.jobId && !jobs.some((j) => j.id === draft.jobId);
  const opts = jobs.map((j) =>
    `<option value="${esc(j.id)}" ${j.id === draft.jobId ? 'selected' : ''}>${esc(j.name)}(${j.rate}元/时)</option>`);
  // 编辑的记录用了已删除的岗位：给出占位选项避免静默换成别的岗位
  if (deletedPlaceholder) {
    opts.unshift('<option value="" selected>原岗位已删除，请重选</option>');
  }
  // 空白自定义：不绑定岗位也能打卡，时薪当条手动输入并快照
  opts.push(`<option value=""${draft.jobId === '' && !deletedPlaceholder ? ' selected' : ''}>自定义（不设岗位）</option>`);
  return opts.join('');
}

function renderTabs() {
  const tabs = [
    ['hours', '工时'], ['day', '日结'], ['time', '时间'],
  ];
  document.getElementById('dlg-tabs').innerHTML = tabs
    .map(([t, label]) => `<button data-act="set-type" data-type="${t}" class="${draft.type === t ? 'on' : ''}">${label}</button>`)
    .join('');
}

function renderBody() {
  const body = document.getElementById('dlg-body');
  if (draft.type === 'hours') {
    // 自定义连打模式：chips 用自定义时长组覆盖「最近记录」自动学习档位
    const qf = getQuickFill();
    const chips = qf && qf.mode === 'custom' && qf.customHours && qf.customHours.length ? qf.customHours : recentDurations();
    body.innerHTML = `
      <div class="dur-input">
        <button data-act="dur-dec" aria-label="减半小时">−0.5</button>
        <input id="dlg-hours" type="number" step="0.5" min="0" max="24" inputmode="decimal" placeholder="0" value="${draft.hours}">
        <span class="unit">h</span>
        <button data-act="dur-inc" aria-label="加半小时">+0.5</button>
      </div>
      <div class="dur-chips">
        ${chips.map((h) => `<button data-act="chip" data-h="${h}">${fmtHours(h)}</button>`).join('')}
      </div>`;
  } else if (draft.type === 'day') {
    body.innerHTML = `
      <div class="num-input">
        <input id="dlg-amount" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0" value="${draft.amount}">
        <span class="unit">元</span>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="time-row">
        <input type="time" id="dlg-start" value="${draft.start}">
        <span class="time-sep">至</span>
        <input type="time" id="dlg-end" value="${draft.end}">
      </div>
      <div class="time-hint" id="time-hint"></div>`;
  }
}

function syncFromInputs() {
  const hours = document.getElementById('dlg-hours');
  if (hours) draft.hours = hours.value === '' ? '' : Number(hours.value);
  const amount = document.getElementById('dlg-amount');
  if (amount) draft.amount = amount.value === '' ? '' : Number(amount.value);
  const start = document.getElementById('dlg-start');
  if (start) draft.start = start.value;
  const end = document.getElementById('dlg-end');
  if (end) draft.end = end.value;
  const job = document.getElementById('dlg-job');
  if (job) draft.jobId = job.value;
  const customRate = document.getElementById('dlg-custom-rate');
  if (customRate) draft.customRate = customRate.value === '' ? '' : Number(customRate.value);
  const ot = document.getElementById('dlg-overtime');
  if (ot) draft.overtime = ot.checked;
  const note = document.getElementById('dlg-note');
  if (note) draft.note = note.value;
  const settled = document.getElementById('dlg-settled');
  if (settled) draft.settled = settled.checked;
}

function stepDuration(delta) {
  const input = document.getElementById('dlg-hours');
  const cur = input.value === '' ? 0 : Number(input.value);
  const next = Math.min(24, Math.max(0, Math.round((cur + delta) * 10) / 10));
  input.value = next === 0 && delta < 0 ? '' : next;
  draft.hours = input.value === '' ? '' : next;
  updatePreview();
}

/** 时薪输入行只在空白自定义岗位且非日结型时显示 */
function updateCustomRateRow() {
  const row = document.getElementById('dlg-custom-rate-row');
  if (row) row.hidden = !(draft.jobId === '' && draft.type !== 'day');
}

function updatePreview() {
  const prev = document.getElementById('dlg-preview');
  if (!prev) return;
  const job = draft.jobId ? getJob(draft.jobId) : null;
  // 正常岗位用快照/现价；空白自定义用本条手动时薪
  const rate = job ? currentRate(job) : (draft.jobId ? 0 : (Number(draft.customRate) || 0));
  let income = 0;
  let text = '';
  if (draft.type === 'hours') {
    const hours = Number(draft.hours) || 0;
    income = computeIncome({ type: 'hours', hours, rate });
    if (hours) text += `${fmtHours(hours)} × ${rate}元/时 · `;
  } else if (draft.type === 'day') {
    income = computeIncome({ type: 'day', amount: Number(draft.amount) || 0 });
  } else {
    const hint = document.getElementById('time-hint');
    if (draft.start && draft.end) {
      const hours = timeToHours(draft.start, draft.end);
      const cross = draft.end < draft.start ? '（跨零点，按次日算）' : hours === 0 ? '（上下班时间相同，请检查）' : '';
      if (hint) hint.textContent = `实际 ${fmtHours(hours)}${cross}`;
      income = computeIncome({ type: 'hours', hours, rate });
      text += `${fmtHours(hours)} × ${rate}元/时 · `;
    } else if (hint) {
      hint.textContent = '';
    }
  }
  prev.textContent = text + `收入 ${income} 元`;
  syncChips();
}

/** 预览与落库共用的时薪口径：编辑未换岗时用原快照，其余用岗位现价 */
function currentRate(job) {
  return baseJobId === draft.jobId && baseRate !== null ? baseRate : job.rate;
}

/** 空白自定义岗位的本条时薪：非空且 0~10000，非法返回 null 并提示 */
function readCustomRate() {
  const el = document.getElementById('dlg-custom-rate');
  const v = el ? el.value : '';
  if (v === '') { alert('请输入本条时薪（自定义岗位不设默认价）'); return null; }
  const r = Number(v);
  if (!Number.isFinite(r) || r < 0 || r > 10000) { alert('时薪需在 0~10000 之间'); return null; }
  return r;
}

function confirmSave() {
  const job = draft.jobId ? getJob(draft.jobId) : null;
  if (draft.jobId && !job) { alert('岗位不存在，请重新选择'); return; }
  // 空白自定义：工时/时间型必须手动填本条时薪（空输入拦截，与显式 0 区分）
  if (!draft.jobId && draft.type !== 'day' && readCustomRate() === null) return;

  // 弹窗打开期间记录可能已被其他窗口修改（storage 同步），覆盖前确认
  const cur = getRecord(editingDate);
  const snapNow = cur ? JSON.stringify(cur) : null;
  if (snapNow !== baseSnapshot && !confirm('该日记录已被其他窗口修改，仍要覆盖保存？')) return;

  // 时薪口径：正常岗位用快照/现价，空白自定义用本条手动时薪（均快照进记录）
  const rate = job ? currentRate(job) : (Number(draft.customRate) || 0);

  let rec;
  if (draft.type === 'hours') {
    const hours = Number(draft.hours);
    if (!(hours > 0 && hours <= 24)) { alert('请输入 0~24 的工时'); return; }
    rec = { type: 'hours', hours, jobId: draft.jobId, rate };
  } else if (draft.type === 'day') {
    if (draft.amount === '' || !Number.isFinite(Number(draft.amount))) { alert('请输入日结金额'); return; }
    const amount = Number(draft.amount);
    if (amount < 0 || amount > 1000000) { alert('日结金额需在 0~1000000 之间'); return; }
    rec = { type: 'day', amount, jobId: draft.jobId, rate: 0 };
  } else {
    if (!draft.start || !draft.end) { alert('请选择上下班时间'); return; }
    const hours = timeToHours(draft.start, draft.end);
    if (hours === 0) { alert('上下班时间相同，请检查是否填错'); return; }
    rec = { type: 'time', hours, start: draft.start, end: draft.end, jobId: draft.jobId, rate };
  }
  rec.overtime = draft.overtime;
  rec.note = draft.note.trim();
  rec.settled = draft.settled;
  rec.income = computeIncome(rec);
  saveRecord(editingDate, rec);
  dlg.close();
  document.dispatchEvent(new CustomEvent('slr:changed'));
}

function confirmDelete() {
  if (confirm(`删除 ${editingDate} 的打卡记录？`)) {
    deleteRecord(editingDate);
    dlg.close();
    document.dispatchEvent(new CustomEvent('slr:changed'));
  }
}

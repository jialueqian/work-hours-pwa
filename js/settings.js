// settings.js — 岗位管理 + 数据导入导出
import {
  getJobs, getJob, addJob, updateJob, deleteJob, getDefaultJobId, setDefaultJob,
  exportJSON, importJSON, importXlsxRows, exportCSV, importBatch, allRecords, esc, fmtHours,
  getQuickFill, setQuickFill, getWallpaper, setWallpaper,
  getSettlementMode, setSettlementMode,
} from './store.js';
import { readXlsxRows, parseOriginalRows, buildOriginalXlsx } from './xlsx.js';
import { installState, promptInstall, onInstallStateChange } from './install.js';

const root = document.getElementById('view-settings');
let editingJobId = null; // 编辑岗位时的表单状态

// 原生容器（安卓 APK）：app.js 已检测 AndroidBridge 并给 <html> 加 is-native
const IS_NATIVE = typeof window !== 'undefined' && !!(window.AndroidBridge && window.AndroidBridge.saveFile);

/** 版本号由 index.html 的 meta 提供（升 SW CACHE 时同步改 meta） */
function appVersion() {
  const el = document.querySelector('meta[name="slr-version"]');
  return el && el.content ? el.content : 'v?';
}

/** 复制文本：优先 Clipboard API，老内核回退 execCommand；结果写进 #copy-result */
async function copyText(text) {
  const out = document.getElementById('copy-result');
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (out) out.textContent = '已复制，粘贴到浏览器地址栏打开即可';
  } catch (_) {
    if (out) out.textContent = '复制失败，请手动复制：' + text;
  }
}

/** 清 SW 缓存并重新注册；localStorage 不动，打卡数据保留 */
async function hardRefresh() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (_) { /* 清理失败也继续刷新 */ }
  location.reload();
}

export function renderSettings() {
  // 编辑目标岗位可能已被其他窗口/storage 同步删除，先清悬空引用防渲染崩溃
  if (editingJobId && !getJob(editingJobId)) editingJobId = null;
  const jobs = getJobs();
  const defaultId = getDefaultJobId();
  const qf = getQuickFill();
  const wp = getWallpaper();
  const settleMode = getSettlementMode();
  const state = installState();
  root.innerHTML = `
    <div class="settings-head"><h1>设置</h1></div>

    <div class="sec">
      <h2>岗位管理</h2>
      ${jobs.length ? '' : '<p class="hint">还没有岗位。打卡时可先选「自定义（不设岗位）」临时记，或在此添加常用岗位。</p>'}
      ${jobs.map((j) => `
        <div class="job-row">
          <div class="job-info">
            <b>${esc(j.name)}</b><span>${j.rate}元/时</span>${j.id === defaultId ? '<span class="def-tag">默认</span>' : ''}
          </div>
          <div class="job-btns">
            ${j.id === defaultId ? '' : `<button class="job-btn" data-act="set-def" data-id="${esc(j.id)}">设默认</button>`}
            <button class="job-btn" data-act="edit-job" data-id="${esc(j.id)}">编辑</button>
            <button class="job-btn danger" data-act="del-job" data-id="${esc(j.id)}">删除</button>
          </div>
        </div>`).join('')}
      <div class="job-form">
        <input id="job-name" placeholder="岗位名称" value="${editingJobId ? esc(getJob(editingJobId).name) : ''}">
        <input id="job-rate" type="number" min="0" step="0.5" inputmode="decimal" placeholder="时薪" value="${editingJobId ? getJob(editingJobId).rate : ''}">
        <button class="btn-primary" data-act="${editingJobId ? 'update-job' : 'add-job'}">${editingJobId ? '保存修改' : '添加岗位'}</button>
        ${editingJobId ? '<button class="btn-ghost" data-act="cancel-edit">取消</button>' : ''}
      </div>
    </div>

    <div class="sec web-only">
      <h2>安装到手机（推荐）</h2>
      ${state === 'done' ? '<p class="hint ok">✅ 已以独立 App 形态运行</p>' : `
      ${state === 'native' ? '<button class="btn-primary" data-act="prompt-install">一键添加到桌面</button>' : ''}
      ${state === 'ios-guide' ? '<p class="hint">iOS：用 <b>Safari</b> 打开本页（微信/Chrome 里不行）→ 点底部中间的分享按钮（□↑）→「添加到主屏幕」→ 确认。链接要带完整访问码，别手动删掉 ?sharecode=…。</p>' : ''}
      ${state === 'menu-guide' ? '<p class="hint">安卓：点浏览器菜单（⋮ 或 ≡）→「添加到主屏幕 / 安装应用」。<br>国产浏览器若找不到入口，请把链接复制到 <b>Chrome 或手机自带浏览器</b>打开后再操作；微信内打开请先点右上角 ··· 用系统浏览器打开。</p>' : ''}
      <p class="hint">添加到桌面后全屏无地址栏、有独立图标与启动画面（iOS），离线可用，不用重装。<b>注意</b>：iOS 主屏幕 App 与 Safari 的数据相互隔离——如果 Safari 里已有记录，添加后先用「数据备份 → 导出/导入」迁移一次。</p>`}
    </div>

    <div class="sec web-only">
      <h2>安卓原生版安装包（APK）</h2>
      <div class="data-btns">
        <a class="data-btn" href="./work-hours.apk${location.search}" download="记工时.apk">下载 APK（仅安卓）</a>
        <button class="data-btn" data-act="copy-apk">复制下载直链</button>
      </div>
      <p class="hint">多数国产浏览器与微信会拦截 APK 下载；请用 Chrome 或手机自带浏览器打开本站再点。这是<b>原生版安装包</b>：打开就是软件本体、完全离线、数据存在手机本地，不依赖任何网址。覆盖安装不清数据，卸载应用才会清；换机/更新前记得先「导出备份(JSON)」。</p>
    </div>

    <div class="sec web-only">
      <h2>打不开链接 / 下载不了？</h2>
      <p class="hint">链接末尾的 <code>?sharecode=…</code> 不能丢：部分国产浏览器会截断参数或禁用第三方 Cookie，导致 403 或首屏白屏。</p>
      <div class="data-btns">
        <button class="data-btn" data-act="copy-link">复制完整链接</button>
      </div>
      <p class="hint">把复制的链接粘贴到 <b>Chrome 或手机自带浏览器</b>地址栏打开；微信内请点右上角 ··· 用系统浏览器打开。首屏能开但没样式时，用「关于」里的强制刷新。</p>
      <div id="copy-result" class="hint ok"></div>
    </div>

    <div class="sec">
      <h2>打卡设置</h2>
      <div class="dlg-row">
        <label>连打预填</label>
        <select id="qf-mode">
          <option value="last" ${qf.mode !== 'custom' ? 'selected' : ''}>跟随最近记录</option>
          <option value="custom" ${qf.mode === 'custom' ? 'selected' : ''}>自定义时长</option>
        </select>
      </div>
      ${qf.mode === 'custom' ? `
      <p class="hint">打卡弹窗的时长块将显示下面的自定义时长组（覆盖「最近记录」档位），可存多个：</p>
      <div class="cf-chips">
        ${(qf.customHours || []).map((h) => `
          <span class="cf-chip">${fmtHours(h)}<button class="cf-del" data-act="del-cf" data-h="${h}" aria-label="删除该时长">×</button></span>`).join('')}
        ${(qf.customHours || []).length ? '' : '<span class="hint cf-empty">还没添加，在下面输入时长后点「添加」</span>'}
      </div>
      <div class="cf-add">
        <input id="cf-hours" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" placeholder="如 2.5">
        <button class="btn-ghost" data-act="add-cf">添加</button>
      </div>` : ''}
    </div>

    <div class="sec">
      <h2>结算设置</h2>
      <div class="settle-opt${settleMode === 'record' ? ' on' : ''}" data-act="set-settle-mode" data-mode="record">
        <div class="settle-opt-txt"><b>按记录结算</b><span>每条打卡单独标记；统计页可一键结算当月全部</span></div>
        <i class="radio"></i>
      </div>
      <div class="settle-opt${settleMode === 'half-month' ? ' on' : ''}" data-act="set-settle-mode" data-mode="half-month">
        <div class="settle-opt-txt"><b>每半个月结算</b><span>1–15 日、16 日–月末各为一期，按本期汇总并整期结算</span></div>
        <i class="radio"></i>
      </div>
      <p class="hint">切换只改变结算的统计与操作方式，不影响历史记录与金额。</p>
    </div>

    <div class="sec">
      <h2>外观</h2>
      <p class="hint">日历页的汇总卡可以点一下翻转，背面显示「最忙的一周」工时分布——不需要设置开关。</p>
      <div class="data-btns">
        <button class="data-btn" data-act="pick-wallpaper">选择背景图片</button>
        ${wp ? '<button class="data-btn" data-act="clear-wallpaper">移除背景</button>' : ''}
        <input type="file" id="wallpaper-file" accept="image/*" hidden>
      </div>
      ${wp ? `
      <div class="dlg-row">
        <label>不透明度</label>
        <input type="range" id="wp-opacity" min="0" max="100" value="${Math.round((wp.opacity == null ? 0.5 : wp.opacity) * 100)}">
      </div>
      <div class="dlg-row">
        <label>截取方式</label>
        <select id="wp-fit">
          <option value="cover" ${wp.fit !== 'contain' && wp.fit !== 'stretch' ? 'selected' : ''}>按比例截取填满</option>
          <option value="contain" ${wp.fit === 'contain' ? 'selected' : ''}>完整显示</option>
          <option value="stretch" ${wp.fit === 'stretch' ? 'selected' : ''}>拉伸填满</option>
        </select>
      </div>` : ''}
      <p class="hint">背景图自动压缩后保存在本机浏览器，不上传服务器。开启后卡片会半透明以透出背景。</p>
    </div>

    <div class="sec">
      <h2>数据备份</h2>
      <div class="data-btns">
        <button class="data-btn" data-act="export-json">导出备份(JSON)</button>
        <button class="data-btn" data-act="export-xlsx">导出表格(XLSX)</button>
        <button class="data-btn" data-act="export-csv">导出表格(CSV)</button>
        <button class="data-btn" data-act="import-json">导入备份</button>
        <input type="file" id="import-file" accept=".json,.txt,.xlsx" hidden>
      </div>
      <p class="hint" id="storage-info">本地存储状态检查中…</p>
      <p class="hint">${IS_NATIVE ? '数据存在应用内部的本地存储，不依赖任何网站域名，卸载应用才会清除。系统清理或换手机不会自动带走，请定期导出备份。' : '导入自动识别两种文件：本工具导出的 JSON 备份、原版 App 导出的 Excel(.xlsx)。Excel 导入按日期覆盖合并，缺的岗位自动创建。数据只存在本机浏览器里，请定期导出备份。'}</p>
    </div>

    <div class="sec">
      <h2>批量导入</h2>
      <p class="hint">每行一条，同日期覆盖：</p>
      <p class="hint mono">2026-11-01 2h 三楼取餐<br>2026-11-01 2.5（h 可省略）<br>2026-11-05 日结 150</p>
      <textarea id="batch-input" rows="5" placeholder="2026-11-01 2h 三楼取餐"></textarea>
      <button class="data-btn" data-act="batch-import">批量导入</button>
      <div id="batch-result"></div>
    </div>

    <div class="sec">
      <h2>关于</h2>
      <p class="hint">记工时 ${esc(appVersion())} · 零广告零跳转 · ${IS_NATIVE ? '安卓原生版：完全离线，数据存本机' : '数据本地存储'}</p>
      <div class="data-btns">
        <button class="data-btn" data-act="hard-refresh">强制刷新（清缓存）</button>
      </div>
      <p class="hint">以本页版本号为准；看到旧界面时点上面的强制刷新（不会删除打卡数据）。</p>
      <p class="hint">由 <a class="about-link" href="https://zcode.z.ai" target="_blank" rel="noopener">ZCode</a> 托管</p>
    </div>`;

  renderStorageInfo();
}

/** 异步填充存储持久化状态与用量 */
function renderStorageInfo() {
  const el = document.getElementById('storage-info');
  if (!el || !navigator.storage) return;
  Promise.all([
    navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
    navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null),
  ]).then(([persisted, est]) => {
    const usage = est && Number.isFinite(est.usage)
      ? `${(est.usage / 1024).toFixed(1)} KB` + (Number.isFinite(est.quota) ? ` / 配额 ${(est.quota / 1024 / 1024).toFixed(0)} MB` : '')
      : '未知';
    el.textContent = persisted
      ? `✅ 本地存储已持久化，系统不会自动清理 · 已用 ${usage}`
      : `⚠️ 本地存储为常规模式，系统空间紧张时可能清理 · 已用 ${usage}`;
  }).catch(() => {
    el.textContent = '本地存储状态未知';
  });
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'set-settle-mode') {
    setSettlementMode(el.dataset.mode);
    renderSettings();
    document.dispatchEvent(new CustomEvent('slr:changed'));
  } else if (act === 'copy-link') {
    copyText(location.href);
  } else if (act === 'copy-apk') {
    const u = new URL('./work-hours.apk', location.href);
    u.search = location.search; // 保留访问码，否则直链会 403
    copyText(u.href);
  } else if (act === 'hard-refresh') {
    if (!confirm('清除本机缓存并重新加载？打卡数据不会删除。')) return;
    hardRefresh();
  } else if (act === 'add-job') {
    const name = document.getElementById('job-name').value.trim();
    const rate = readJobRate();
    if (!name) { alert('请输入岗位名称'); return; }
    if (rate === null) return;
    const job = addJob(name, rate);
    if (!getDefaultJobId()) setDefaultJob(job.id);
    renderSettings();
    document.dispatchEvent(new CustomEvent('slr:changed'));
  } else if (act === 'edit-job') {
    editingJobId = el.dataset.id;
    renderSettings();
  } else if (act === 'cancel-edit') {
    editingJobId = null;
    renderSettings();
  } else if (act === 'update-job') {
    const name = document.getElementById('job-name').value.trim();
    const rate = readJobRate();
    if (!name) { alert('请输入岗位名称'); return; }
    if (rate === null) return;
    updateJob(editingJobId, { name, rate });
    editingJobId = null;
    renderSettings();
  } else if (act === 'set-def') {
    setDefaultJob(el.dataset.id);
    renderSettings();
  } else if (act === 'del-job') {
    const used = Object.values(allRecords()).filter((r) => r.jobId === el.dataset.id).length;
    const msg = used
      ? `该岗位有 ${used} 条历史记录引用（记录金额已快照，删除不影响历史数据），确认删除？`
      : '确认删除该岗位？';
    if (confirm(msg)) {
      if (editingJobId === el.dataset.id) editingJobId = null; // 删除编辑中的岗位，避免渲染悬空引用
      deleteJob(el.dataset.id);
      renderSettings();
    }
  } else if (act === 'pick-wallpaper') {
    document.getElementById('wallpaper-file').click();
  } else if (act === 'clear-wallpaper') {
    if (confirm('移除自定义背景？')) {
      setWallpaper(null);
      renderSettings();
      document.dispatchEvent(new CustomEvent('slr:changed'));
    }
  } else if (act === 'add-cf') {
    const el = document.getElementById('cf-hours');
    if (!el || el.value === '') { alert('请输入时长'); return; }
    const h = Number(el.value);
    if (!Number.isFinite(h) || h < 0.5 || h > 24) { alert('时长需在 0.5~24 之间'); return; }
    const list = (getQuickFill().customHours || []).filter((x) => x !== h);
    list.push(h);
    if (list.length > 5) { alert('最多 5 个，请先删掉一个再添加'); return; }
    setQuickFill({ customHours: list });
    renderSettings();
  } else if (act === 'del-cf') {
    const h = Number(el.dataset.h);
    setQuickFill({ customHours: (getQuickFill().customHours || []).filter((x) => x !== h) });
    renderSettings();
  } else if (act === 'prompt-install') {
    promptInstall();
  } else if (act === 'export-xlsx') {
    const records = allRecords();
    const keys = Object.keys(records).sort();
    // 日结记录在「按工时」布局里没有可往返的表示（导出 0 小时会被导入解析拒绝）→ 跳过并明示
    const dayCount = keys.filter((k) => records[k].type === 'day').length;
    if (dayCount && !confirm(`有 ${dayCount} 条日结记录，Excel「按工时」格式无法保留（重新导入会丢失），本次导出将跳过它们。完整备份请用「导出备份(JSON)」。继续？`)) return;
    const rows = keys.filter((k) => records[k].type !== 'day').map((k) => {
      const rec = records[k];
      const job = getJob(rec.jobId);
      return {
        date: k,
        hours: rec.hours,
        jobName: job ? job.name : '已删除岗位',
        rate: job ? job.rate : 0,
        income: rec.income,
        note: rec.note || '',
      };
    });
    if (!rows.length) { alert(dayCount ? '只有日结记录，请用「导出备份(JSON)」' : '还没有记录，先打卡或导入'); return; }
    download(`极简记工时-${today()}.xlsx`, buildOriginalXlsx(rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } else if (act === 'export-json') {
    download(`记工时备份-${today()}.json`, exportJSON(), 'application/json');
  } else if (act === 'export-csv') {
    download(`记工时-${today()}.csv`, exportCSV(), 'text/csv');
  } else if (act === 'import-json') {
    document.getElementById('import-file').click();
  } else if (act === 'batch-import') {
    const text = document.getElementById('batch-input').value;
    if (!text.trim()) { alert('请先粘贴导入内容'); return; }
    const res = importBatch(text);
    document.getElementById('batch-result').innerHTML =
      `<p class="hint ok">导入 ${res.imported} 条${res.overwritten ? `，覆盖 ${res.overwritten} 条旧记录` : ''}</p>` +
      res.warnings.map((w) => `<p class="hint warn">${esc(w)}</p>`).join('');
    document.dispatchEvent(new CustomEvent('slr:changed'));
  }
}

// 文件选择与外观控件（change 事件无法用委托里的 data-act，单独绑）
export function initSettings() {
  root.addEventListener('click', onClick);
  onInstallStateChange(() => renderSettings()); // 安装能力就绪/已安装时刷新安装区
  root.addEventListener('input', (e) => {
    // 不透明度实时预览：只改 CSS 变量，change 时才落盘（避免滑条高频写 localStorage）
    if (e.target.id === 'wp-opacity') {
      document.documentElement.style.setProperty('--wallpaper-opacity', String(e.target.value / 100));
    }
  });
  root.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'import-file') {
      handleImportFile(e.target);
    } else if (id === 'wallpaper-file') {
      const file = e.target.files[0];
      if (file) {
        compressImage(file)
          .then((dataUrl) => {
            const wp = getWallpaper();
            setWallpaper({ dataUrl, opacity: wp ? wp.opacity : 0.5, fit: wp ? wp.fit : 'cover' });
            renderSettings();
            document.dispatchEvent(new CustomEvent('slr:changed'));
          })
          .catch((err) => alert(err.message));
      }
      e.target.value = '';
    } else if (id === 'wp-opacity') {
      const wp = getWallpaper();
      if (wp) setWallpaper({ ...wp, opacity: e.target.value / 100 });
    } else if (id === 'wp-fit') {
      const wp = getWallpaper();
      if (wp) setWallpaper({ ...wp, fit: e.target.value });
    } else if (id === 'qf-mode') {
      setQuickFill({ mode: e.target.value });
      renderSettings();
    }
  });
}

function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const finish = () => { input.value = ''; };
  if (file.type.startsWith('image/')) {
    alert('这是张图片，不是备份文件——图片里的数据请用下方「批量导入」粘贴文字录入，或导入本工具导出的 JSON 备份');
    finish();
    return;
  }
  if (file.size === 0) {
    alert('选中的文件是空的，请重新导出或重传');
    finish();
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const bytes = new Uint8Array(reader.result);
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        alert('这是 gzip 压缩包，先解压出里面的文件再导入');
        return;
      }
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        // zip/Excel：原版 App 导出的「按工时」表格
        const rawRows = await readXlsxRows(bytes);
        const parsed = parseOriginalRows(rawRows);
        const first = parsed.rows[0];
        const last = parsed.rows[parsed.rows.length - 1];
        if (!confirm(`Excel 导入：识别到 ${parsed.rows.length} 条记录（${first.date} ~ ${last.date}）。\n同日期覆盖现有记录，缺的岗位按时薪自动创建。确认导入？`)) return;
        const res = importXlsxRows(parsed.rows);
        const extra = res.warnings.length ? '\n\n注意：\n' + res.warnings.join('\n') : '';
        alert(`导入成功：${res.imported} 条（覆盖已有 ${res.overwritten} 条）${res.jobsCreated ? '，新建岗位 ' + res.jobsCreatedNames.join('、') : ''}${extra}`);
        editingJobId = null;
        renderSettings();
        document.dispatchEvent(new CustomEvent('slr:changed'));
        return;
      }
      const text = new TextDecoder().decode(bytes);
      const current = Object.keys(allRecords()).length;
      if (!confirm(`导入将覆盖当前 ${current} 条记录及岗位设置，确认？`)) return;
      const res = importJSON(text);
      editingJobId = null;
      alert(`导入成功，共 ${res.records} 条记录${res.wallpaperDropped ? '；背景图因存储空间不足未一并恢复，可稍后重新设置' : ''}`);
      renderSettings();
      document.dispatchEvent(new CustomEvent('slr:changed'));
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  };
  reader.onerror = () => alert('文件读取失败');
  reader.readAsArrayBuffer(file);
  finish();
}

/** 背景图压缩：最长边 1600px、JPEG 质量 0.85 起步，超 2.2MB 逐步降质，仍超则拒绝 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b0c0b'; // 透明 PNG 转 JPEG 的深色底
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let q = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', q);
      while (dataUrl.length > 2200000 && q > 0.4) {
        q -= 0.15;
        dataUrl = canvas.toDataURL('image/jpeg', q);
      }
      if (dataUrl.length > 2200000) reject(new Error('图片过大，压缩后仍超出存储预算，请换一张'));
      else resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败：手机可能不支持此格式（如 HEIC/实况照片），请改用 JPG/PNG，或先截图再选择'));
    };
    img.src = url;
  });
}

/** 读取并校验时薪输入：非空且在 0~10000，非法返回 null 并提示 */
function readJobRate() {
  const value = document.getElementById('job-rate').value;
  if (value === '') {
    alert('请输入时薪'); // 空输入与 0 区分：忘填和免费岗是两回事
    return null;
  }
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 10000) {
    alert('时薪需在 0~10000 之间');
    return null;
  }
  return rate;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function download(filename, content, mime) {
  // 原生容器：WebView 不响应 a[download]，改走安卓桥调系统「保存到」对话框
  if (IS_NATIVE) {
    const b64 = typeof content === 'string'
      ? btoa(unescape(encodeURIComponent(content)))
      : bytesToB64(content);
    try {
      window.AndroidBridge.saveFile(filename, b64);
    } catch (err) {
      alert('导出失败：' + (err && err.message ? err.message : err));
    }
    return;
  }
  const blob = typeof content === 'string'
    ? new Blob([content], { type: mime + ';charset=utf-8' })
    : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Uint8Array → base64：分块拼接避免 apply 参数超限 */
function bytesToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
  }
  return btoa(s);
}

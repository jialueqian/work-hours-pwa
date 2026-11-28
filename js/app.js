// app.js — 入口：视图切换（含发布页门厅）、底部导航、模块初始化、SW 注册
import { initCalendar, renderCalendar, gotoMonth } from './calendar.js';
import { initDialog, openPunchDialog } from './dialog.js';
import { initStats, renderStats } from './stats.js';
import { initSettings, renderSettings } from './settings.js';
import { getWallpaper, allRecords } from './store.js';
import { initInstall, installState, promptInstall, onInstallStateChange } from './install.js';
import { initLanding } from './landing.js';

let current = 'calendar';

const INSTALL_DISMISS_KEY = 'slr_install_bar_dismissed';

/** 安装引导条：浏览器不会主动弹安装提示（有参与度门槛/iOS 没有），自己提供入口。
    发布页视图下隐藏（发布页自带安装区） */
function renderInstallBar() {
  const bar = document.getElementById('install-bar');
  if (!bar) return;
  if (current === 'landing') { bar.hidden = true; return; }
  const state = installState();
  const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  if (state === 'done' || dismissed) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const textEl = document.getElementById('install-bar-text');
  const btn = document.getElementById('install-bar-btn');
  if (state === 'native') {
    textEl.textContent = '把记工时装到桌面，像 App 一样使用';
    btn.textContent = '安装';
    btn.hidden = false;
  } else if (state === 'ios-guide') {
    textEl.textContent = '安装：点底部分享按钮 →「添加到主屏幕」';
    btn.hidden = true;
  } else {
    textEl.textContent = '安装：浏览器菜单 →「添加到主屏幕 / 安装应用」';
    btn.hidden = true;
  }
}

/** 把自定义背景应用到页面（设置变更后与启动时调用） */
function applyWallpaper() {
  const w = getWallpaper();
  const style = document.documentElement.style;
  if (w && w.dataUrl) {
    const fitMap = { cover: 'cover', contain: 'contain', stretch: '100% 100%' };
    style.setProperty('--wallpaper', `url("${w.dataUrl}")`);
    style.setProperty('--wallpaper-opacity', String(w.opacity == null ? 0.5 : w.opacity));
    style.setProperty('--wallpaper-fit', fitMap[w.fit] || 'cover');
    document.body.classList.add('has-wallpaper');
  } else {
    style.removeProperty('--wallpaper');
    style.removeProperty('--wallpaper-opacity');
    style.removeProperty('--wallpaper-fit');
    document.body.classList.remove('has-wallpaper');
  }
}

function switchView(name) {
  const prev = current;
  current = name;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  // 发布页是全屏叙事：隐藏底部导航与安装条；离开时停掉雇佣计时器
  document.getElementById('bottom-nav').hidden = name === 'landing';
  if (prev === 'landing' && name !== 'landing') {
    document.getElementById('view-landing').dispatchEvent(new CustomEvent('slr:landing-stop'));
  }
  renderInstallBar();
  window.scrollTo(0, 0);
  if (name === 'calendar') renderCalendar();
  else if (name === 'stats') renderStats();
  else if (name === 'settings') renderSettings();
}

document.getElementById('bottom-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (btn) switchView(btn.dataset.view);
});

initCalendar((dateKey) => openPunchDialog(dateKey));
initDialog();
initStats((dateKey) => {
  // 统计页点记录 → 跳到日历对应月份并打开编辑
  const [y, m] = dateKey.split('-').map(Number);
  switchView('calendar');
  gotoMonth(y, m);
  openPunchDialog(dateKey);
});
initSettings();
initLanding(document.getElementById('view-landing'));

// 发布页「开始记工时」→ 进入应用
document.getElementById('view-landing').addEventListener('slr:landing-enter', () => switchView('calendar'));

// 数据变化后刷新两个数据视图（结算模式切换会同时影响月历与统计页）
document.addEventListener('slr:changed', () => {
  renderCalendar();
  renderStats();
  applyWallpaper();
});

applyWallpaper();
initInstall();
onInstallStateChange(renderInstallBar);
renderInstallBar();
document.getElementById('install-bar-btn').addEventListener('click', () => {
  promptInstall().then(renderInstallBar);
});
document.getElementById('install-bar-close').addEventListener('click', () => {
  localStorage.setItem(INSTALL_DISMISS_KEY, '1');
  renderInstallBar();
});
// 启动视图：有记录的老用户直达应用；全新访客先看发布页
switchView(Object.keys(allRecords()).length > 0 ? 'calendar' : 'landing');

// 原生容器（安卓 APK 内置 WebView）标记：设置页据此隐藏 Web 专属区块、导出走原生桥
if (window.AndroidBridge && window.AndroidBridge.saveFile) {
  document.documentElement.classList.add('is-native');
}

// PWA：SW 只在 http(s) 下注册（file:// 打开会报错）
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const hadController = !!navigator.serviceWorker.controller;
  // 更新版 SW 接管时刷新页面（首次安装的 claim 不刷），避免跑旧缓存代码；
  // 弹窗正开着则延迟到关闭后刷，避免丢输入
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const dlgEl = document.getElementById('punch-dialog');
    if (dlgEl && dlgEl.open) {
      dlgEl.addEventListener('close', () => location.reload(), { once: true });
    } else {
      location.reload();
    }
  });
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW 注册失败（不影响使用）', err));

  // 申请持久化存储：阻止浏览器在磁盘紧张时自动清除本地数据（装到主屏幕后尤其重要）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

// 跨零点挂起后恢复可见时重渲染，让「今天」高亮跟上日期
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (current === 'calendar') renderCalendar();
  else if (current === 'stats') renderStats();
});

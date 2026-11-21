// install.js — PWA 安装能力检测与触发（浏览器原生横幅有参与度门槛，自己提供入口）
let deferredPrompt = null;
const listeners = new Set();

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function onInstallStateChange(fn) {
  listeners.add(fn);
}

/** 已以独立 App 形态运行（standalone 或 iOS 主屏幕） */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 伪装 Mac UA
}

/**
 * 安装状态：
 * 'native'    浏览器支持安装对话框，可一键触发
 * 'ios-guide' iOS：需要用户手动分享→添加到主屏幕
 * 'menu-guide'其他浏览器：引导去菜单找「添加到主屏幕」
 * 'done'      已安装
 */
export function installState() {
  if (isStandalone()) return 'done';
  if (deferredPrompt) return 'native';
  if (isIOS()) return 'ios-guide';
  return 'menu-guide';
}

/** 触发原生安装对话框；返回是否成功发起 */
export function promptInstall() {
  if (!deferredPrompt) return Promise.resolve(false);
  const p = deferredPrompt.prompt();
  deferredPrompt = null;
  return p.then(() => {
    notify();
    return true;
  }).catch(() => false);
}

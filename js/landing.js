// landing.js — 产品发布页：两分钟受罪 + 一次解放的滚动叙事
// 场景：hero（雇佣计时器）→ 滚轮地狱（滚动映射爬升+广告扑脸）→ 解放（1 次点击）
//      → 格子垒月 → 翻转卡（最忙一周）→ 小票打印 → 三端安装（落章）→ 尾声
// 兼容基线 Chromium 69+：无 ?? / ?. / inset 简写 / dvh 单用；prefers-reduced-motion 全降级

// 发布页是纯演示叙事，所有数字来自下方 DEMO 常量，不读用户 store（新访客 store 为空）。

const DEMO = {
  year: 2026, month: 11,
  hours: '21.5', pay: '408', days: 4,
  weekHours: '13.5', weekPay: '257', weekDays: 4,
  rate: 20, // ¥/h，雇佣计时器折算
};

const ADS = [
  { t: '恭喜获得红包', s: '立即提现', c: '#e05a5a', th: 0.14 },
  { t: '开通会员免广告', s: '¥18/月', c: '#d88a2b', th: 0.26 },
  { t: '下载官方浏览器', s: '更快更安全', c: '#b06ad0', th: 0.38 },
  { t: '限时特惠 · 点我', s: '跳转中…', c: '#5a8ae0', th: 0.5 },
  { t: '您有一条补贴待领取', s: '过期作废', c: '#e05a5a', th: 0.62 },
  { t: '看视频再免 30 分钟', s: '广告×2', c: '#3fa66b', th: 0.72 },
  { t: '抽奖 · iPhone 免费拿', s: '已有人提现', c: '#d88a2b', th: 0.82 },
  { t: '关闭广告请开通SVIP', s: '仅需 ¥30', c: '#b06ad0', th: 0.9 },
];

/** 把元素的文本拆成逐字 span（stagger 入场用），保留 <br> */
function wrapChars(node) {
  const frag = document.createDocumentFragment();
  let i = 0;
  Array.from(node.childNodes).forEach(function (child) {
    if (child.nodeType === 3) {
      // 文本节点：逐字符包 span
      Array.from(child.textContent).forEach(function (ch) {
        const s = document.createElement('span');
        s.className = 'lp-ch';
        s.textContent = ch;
        s.style.setProperty('--i', i++);
        frag.appendChild(s);
      });
    } else if (child.nodeType === 1) {
      child.style.setProperty('--i', i++);
      frag.appendChild(child); // <br> 等元素原样保留
    }
  });
  node.innerHTML = '';
  node.appendChild(frag);
}

/** 碎片粒子：hell 碎屏解放时广告炸开 */
function spawnShards(hellEl) {
  const ads = hellEl.querySelectorAll('.lp-ad.shown');
  ads.forEach(function (ad) {
    const r = ad.getBoundingClientRect();
    const host = hellEl.querySelector('.lp-hell-sticky');
    for (let i = 0; i < 5; i++) {
      const sh = document.createElement('div');
      sh.className = 'lp-shard';
      sh.style.background = getComputedStyle(ad).backgroundColor;
      sh.style.left = (r.left - host.getBoundingClientRect().left + Math.random() * r.width) + 'px';
      sh.style.top = (r.top - host.getBoundingClientRect().top + Math.random() * r.height) + 'px';
      sh.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
      sh.style.setProperty('--dy', (Math.random() * -180 - 40) + 'px');
      sh.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      host.appendChild(sh);
      setTimeout(function () { sh.remove(); }, 1300);
    }
  });
}

export function initLanding(root) {
  root.innerHTML = tpl();

  const el = {
    hire: root.querySelector('.lp-hire-val'),
    hireFoot: root.querySelector('.lp-hire-foot'),
    hell: root.querySelector('.lp-hell'),
    wheelNum: root.querySelector('.lp-wheel-num'),
    wheelFill: root.querySelector('.lp-wheel-fill'),
    hellTimer: root.querySelector('.lp-hell-timer'),
    hellHint: root.querySelector('.lp-hell-hint'),
    hellSkip: root.querySelector('.lp-hell-skip'),
    hellDone: root.querySelector('.lp-hell-done'),
    hellCount: root.querySelector('.lp-hell-count'),
    release: root.querySelector('.lp-release'),
    receipt: root.querySelector('.lp-receipt'),
    stamp: root.querySelector('.lp-stamp'),
    install: root.querySelector('.lp-install'),
    tail: root.querySelector('.lp-tail'),
    flip: root.querySelector('.lp-flip'),
    demoChips: root.querySelectorAll('.lp-chip'),
    demoNum: root.querySelector('.lp-release-num'),
    demoStep: root.querySelector('.lp-step-num'),
  };

  // ---------- 雇佣计时器：停留即工时 ----------
  let hireStart = null;
  let hireTick = null;
  function hireStartNow() {
    if (hireStart !== null) return;
    hireStart = performance.now();
    hireTick = setInterval(function () {
      const ms = performance.now() - hireStart;
      el.hire.textContent = fmtClock(ms);
      const money = ms / 3600000 * DEMO.rate;
      el.hireFoot.textContent = '按 ¥' + DEMO.rate + '/h 折算 ¥' + money.toFixed(2);
    }, 500);
  }
  function hireStop() {
    if (hireTick) { clearInterval(hireTick); hireTick = null; }
    hireStart = null;
  }
  el.hire.textContent = '00:00.0';
  hireStartNow();
  root.addEventListener('slr:landing-stop', hireStop); // 切走视图时由 app.js 派发

  // ---------- 滚轮地狱：滚动映射爬升（scrollytelling，无事件劫持） ----------
  let hellEntered = false;
  let hellDone = false;
  let hellTimerStart = null;
  let hellTimerTick = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hellEnter() {
    if (hellEntered) return;
    hellEntered = true;
    if (hellTimerStart === null) {
      hellTimerStart = performance.now();
      hellTimerTick = setInterval(function () {
        if (!hellDone && hellTimerStart !== null) {
          el.hellTimer.textContent = fmtClock(performance.now() - hellTimerStart);
        }
      }, 100);
    }
    if (reduceMotion) { hellFinish(true, 'reduce'); }
  }

  function hellScroll() {
    if (hellDone) return;
    const rect = el.hell.getBoundingClientRect();
    const vh = window.innerHeight || 800;
    if (rect.top > vh || rect.bottom < 0) return; // 不在视口内
    if (!hellEntered) hellEnter(); // 首次进入视口即启动（不依赖 IO 回调时序）
    // 区块总滚动行程 = 高度 - 视口；进度映射到 0~2.5h
    const span = Math.max(1, rect.height - vh);
    const p = clamp((vh * 0.5 - rect.top) / span, 0, 1);
    const hours = Math.floor(p * 25) / 10; // 0.1h 步进
    el.wheelNum.textContent = hours.toFixed(1) + 'h';
    el.wheelFill.style.width = (p * 100).toFixed(1) + '%';
    // 广告按进度扑脸
    for (let i = 0; i < ADS.length; i++) {
      const ad = el.hell.querySelector('.lp-ad[data-i="' + i + '"]');
      if (ad && p >= ADS[i].th && !ad.classList.contains('shown')) ad.classList.add('shown');
    }
    if (p >= 1) hellFinish(false, 'scroll');
  }

  function hellFinish(instant, from) {
    if (hellDone) return;
    hellDone = true;
    window.__lpFinishFrom = from || 'unknown';
    const spent = hellTimerStart === null ? 0 : performance.now() - hellTimerStart;
    if (hellTimerTick) { clearInterval(hellTimerTick); hellTimerTick = null; }
    el.hellDone.hidden = false;
    el.hellSkip.hidden = true;
    el.hellHint.hidden = true;
    el.hellCount.textContent = instant ? '0' : fmtClock(spent).replace(/^0:/, '');
    root.querySelector('.lp-hell').classList.add('lp-hell-done');
    // 碎裂解放：广告炸成碎片飞散 + 白闪（reduce/instant 不放粒子，直出完成态）
    if (!instant && !reduceMotion) {
      spawnShards(root.querySelector('.lp-hell'));
      const flash = el.hell.querySelector('.lp-flash');
      if (flash) flash.classList.add('on');
      root.querySelector('.lp-hell').classList.add('lp-shake');
    }
    ADS.forEach(function (a, i) {
      const ad = el.hell.querySelector('.lp-ad[data-i="' + i + '"]');
      if (ad && ad.classList.contains('shown') && !instant) ad.classList.add('crack');
    });
    setTimeout(function () {
      root.querySelector('.lp-hell').classList.add('lp-hell-past');
      root.querySelector('.lp-hell').classList.remove('lp-shake'); // 解放后停止震屏
      el.release.classList.add('lp-in');
      wrapChars(el.release.querySelector('.lp-h2'));
      el.release.querySelector('.lp-h2').classList.add('chars-in');
      chipDemo();
    }, instant ? 200 : 1300);
  }

  el.hellSkip.addEventListener('click', function () { hellFinish(true); });

  // 「开始记工时」/「网页版」按钮 → 进入应用（app.js 监听该事件切视图）
  root.querySelectorAll('.lp-start-btn, .lp-inst-start').forEach(function (b) {
    b.addEventListener('click', function () {
      root.dispatchEvent(new CustomEvent('slr:landing-enter'));
    });
  });

  // ---------- 解放区：1 次点击（chips 自动演示 + 可交互） ----------
  let chipIdx = 0;
  let chipTimer = null;
  function chipDemo() {
    if (chipTimer) return;
    chipTimer = setInterval(function () {
      el.demoChips.forEach(function (c) { c.classList.remove('on'); });
      const c = el.demoChips[chipIdx % el.demoChips.length];
      c.classList.add('on');
      el.demoNum.textContent = c.dataset.h + 'h';
      chipIdx++;
    }, 1400);
  }
  el.demoChips.forEach(function (c) {
    c.addEventListener('click', function () {
      if (chipTimer) { clearInterval(chipTimer); chipTimer = null; }
      el.demoChips.forEach(function (x) { x.classList.remove('on'); });
      c.classList.add('on');
      el.demoNum.textContent = c.dataset.h + 'h';
    });
  });
  // ±0.5 步进演示
  let stepV = 2.5;
  el.demoStep.textContent = stepV.toFixed(1);
  root.querySelector('.lp-step-plus').addEventListener('click', function () {
    stepV = Math.min(24, stepV + 0.5);
    el.demoStep.textContent = stepV.toFixed(1);
    pulse(el.demoStep);
  });
  root.querySelector('.lp-step-minus').addEventListener('click', function () {
    stepV = Math.max(0.5, stepV - 0.5);
    el.demoStep.textContent = stepV.toFixed(1);
    pulse(el.demoStep);
  });
  function pulse(node) {
    node.classList.remove('pulse');
    // 触发重排以重启动画
    void node.offsetWidth;
    node.classList.add('pulse');
  }

  // ---------- 格子墙：30 格逐格点亮（stagger） ----------
  const wall = root.querySelector('.lp-wall');
  const wallRecords = { 1: [2, 36], 2: [3.5, 70], 3: [3.5, 70], 5: [4, 72], 8: [2.5, 45], 9: [2.5, 45], 10: [3.5, 70] };
  for (let d = 1; d <= 30; d++) {
    const r = wallRecords[d];
    const cell = document.createElement('div');
    cell.className = 'lp-wall-cell' + (r ? ' has' : '');
    cell.innerHTML = '<span class="d">' + d + '</span>' +
      (r ? '<span class="w h">' + r[0].toFixed(1) + 'h</span><span class="w p">¥' + r[1] + '</span>' : '');
    cell.style.setProperty('--i', d - 1);
    wall.appendChild(cell);
  }
  const wallIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        wall.classList.add('light-up');
        wallIO.disconnect();
      }
    });
  }, { threshold: 0.25 });
  wallIO.observe(wall);

  // ---------- 翻转卡（真交互，背面数据来自 DEMO 种子） ----------
  el.flip.addEventListener('click', function () {
    el.flip.classList.toggle('flipped');
  });
  el.flip.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.flip.classList.toggle('flipped'); }
  });
  fillFlip();

  // ---------- 小票打印：滚动进度驱动行显现 ----------
  const receiptRows = el.receipt.querySelectorAll('.lp-row');
  const receiptIdx = [];
  receiptRows.forEach(function (r) { receiptIdx.push(r); });

  // ---------- Hero 逐字入场 ----------
  wrapChars(root.querySelector('.lp-h1'));
  requestAnimationFrame(function () {
    root.querySelector('.lp-hero').classList.add('in');
  });

  // ---------- 滚动驱动总控 ----------
  function onScroll() {
    // 视图隐藏（display:none）时 getBoundingClientRect 全零，会让下面的进度计算误判完成——统一守卫
    if (!root.classList.contains('active')) return;
    hellScroll();
    // 小票：容器随滚动「从打印口探出」（clip-path 行程）+ 逐行
    const rRect = el.receipt.getBoundingClientRect();
    const vh0 = window.innerHeight || 800;
    const outP = clamp((vh0 - rRect.top) / (vh0 * 0.75), 0, 1);
    el.receipt.style.clipPath = 'inset(0 0 ' + ((1 - outP) * 100).toFixed(1) + '% 0)';
    const p = clamp((vh0 - rRect.top) / (vh0 * 0.9), 0, 1);
    const show = Math.floor(p * receiptIdx.length);
    receiptIdx.forEach(function (r, i) {
      r.classList.toggle('on', i < show);
    });
    // 落章
    const st = el.stamp.getBoundingClientRect();
    if (st.top < vh * 0.7) {
      if (!el.stamp.classList.contains('stamped')) {
        el.stamp.classList.add('stamped');
        el.install.classList.add('stamped-shake');
      }
    }
    // 色彩情景：hell 之后把页面底色切回主世界
    document.body.classList.toggle('lp-in-hell', inView(el.hell) && !hellDone);
  }
  root.__lpScroll = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // 进入视口触发 hell 计时（区块高 300vh，可见比上限 ~0.33，阈值必须低于它）
  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) hellEnter();
    });
  }, { threshold: 0.05 });
  io.observe(el.hell);

  function inView(node) {
    const r = node.getBoundingClientRect();
    return r.top < (window.innerHeight || 800) && r.bottom > 0;
  }

  // 调试/验收钩子（测试脚本用；不依赖内部状态的外部 API）
  window.__lp = {
    state: function () {
      return { entered: hellEntered, done: hellDone, from: window.__lpFinishFrom || null, top: Math.round(el.hell.getBoundingClientRect().top), vh: window.innerHeight };
    },
    enter: function () { hellEnter(); },
    scroll: onScroll,
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmtClock(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return (m < 10 ? '0' + m : String(m)) + ':' + (sec < 10 ? '0' + sec.toFixed(1) : sec.toFixed(1));
}

function fillFlip() {
  // 发布页是演示叙事：翻转卡背面用 DEMO 常量（与正面 21.5h/¥408 同一套种子数据）。
  // 不读 store —— 新访客 store 为空会显示空白，且 busiestWeek 返回的是 totalHours/totalIncome/daysCount，
  // 与这里旧代码读的 w.hours/w.pay/w.days 键名也不符（双重 bug）。
  const back = document.querySelector('.lp-flip-back');
  if (!back) return;
  back.querySelector('.lp-flip-h').textContent = DEMO.weekHours + 'h';
  back.querySelector('.lp-flip-p').textContent = '¥' + DEMO.weekPay;
  back.querySelector('.lp-flip-d').textContent = DEMO.weekDays + ' 天';
}

function tpl() {
  const chipVals = [2, 2.5, 3.5, 4];
  return `
  <div class="lp">
    <!-- ACT 0 · HERO：雇佣计时器 -->
    <div class="lp-act lp-hero">
      <div class="lp-hire">
        <span class="lp-hire-val">00:00.0</span>
        <span class="lp-hire-unit">本页停留</span>
        <span class="lp-hire-foot">按 ¥${DEMO.rate}/h 折算</span>
      </div>
      <h1 class="lp-h1">工时，<br>一秒都别漏。</h1>
      <p class="lp-sub">给所有兼职的人。零广告、不跳转，<br>录 0.5h 只要一下，月底对账清清楚楚。</p>
      <div class="lp-hero-blk">
        <span class="lp-blk-h">11-10 · 三楼取餐</span>
        <span class="lp-blk-hours">3.5h</span>
        <span class="lp-blk-pay">¥70</span>
      </div>
      <div class="lp-down">↓ 往下滚。先让你亲身受一次罪。</div>
    </div>

    <!-- ACT 1 · 滚轮地狱（sticky 滚动叙事） -->
    <div class="lp-hell">
      <div class="lp-hell-sticky">
        <div class="lp-hell-head">先看看你受过的罪<span class="lp-hell-app">某记工时 · 试用版</span></div>
        <div class="lp-wheel-num">0.0h</div>
        <div class="lp-wheel-bar"><div class="lp-wheel-fill"></div></div>
        <div class="lp-hell-hint">继续滚动 = 在拖那个滚轮。把 2.5h 一格格爬出来。</div>
        <div class="lp-ads">
          ${ADS.map(function (a, i) {
            return '<div class="lp-ad" data-i="' + i + '" style="background:' + a.c + ';top:' + (8 + i * 21) % 60 + '%;' + (i % 2 ? 'right:6px;' : 'left:6px;') + '">' +
              '<b>' + a.t + '</b> ' + a.s + '<span class="lp-ad-x">×</span></div>';
          }).join('')}
        </div>
        <div class="lp-hell-timer">00:00.0</div>
        <button class="lp-hell-skip">我受够了，直接看记工时 →</button>
        <div class="lp-hell-done" hidden>
          这就是录一条 2.5h 的代价——<br>你滚了 <b class="lp-hell-count">0</b> 秒，还关了 ${ADS.length} 个广告。
        </div>
        <div class="lp-flash"></div>
      </div>
    </div>

    <!-- ACT 2 · 解放：1 次点击 -->
    <div class="lp-act lp-release">
      <h2 class="lp-h2">然后，你遇到了记工时。</h2>
      <div class="lp-release-num">2.5h</div>
      <div class="lp-chip-row">
        ${chipVals.map(function (h) {
          return '<button class="lp-chip" data-h="' + h + '">' + h + 'h</button>';
        }).join('')}
      </div>
      <p class="lp-release-note">1 次点击。不用拖滚轮，不用关广告，不用等加载。<br>
      常用档位越用越懂你；要记 0.5h？<b>±0.5</b> 大按钮就在旁边。</p>
      <div class="lp-step">
        <button class="lp-step-btn lp-step-minus">−0.5</button>
        <span class="lp-step-num">2.5</span>
        <button class="lp-step-btn lp-step-plus">+0.5</button>
      </div>
    </div>

    <!-- ACT 3 · 格子垒月 + 翻转卡 -->
    <div class="lp-act lp-month">
      <h2 class="lp-h2">一个月，<span class="lp-green">垒</span>出来。</h2>
      <p class="lp-note">每天一格：蓝的是工时，绿的是钱。这个月的班，一眼看完。</p>
      <div class="lp-wall" id="lp-wall"></div>
      <div class="lp-month-blk">
        <span class="lp-blk-hours">21.5h</span>
        <span class="lp-blk-pay">¥${DEMO.pay}</span>
        <span class="lp-blk-days">${DEMO.days} 天出勤</span>
      </div>
      <div class="lp-flip" tabindex="0" role="button" aria-label="翻面看最忙的一周">
        <div class="lp-flip-inner">
          <div class="lp-flip-face lp-flip-front">
            <span class="lp-flip-tag">本月汇总 · 点一下翻面</span>
            <div class="lp-flip-big">21.5h · ¥${DEMO.pay}</div>
            <div class="lp-flip-small">${DEMO.days} 天 · 最忙的一周在背面</div>
          </div>
          <div class="lp-flip-face lp-flip-back">
            <span class="lp-flip-tag">最忙的一周</span>
            <div class="lp-flip-row"><span class="lp-flip-h">—</span><span class="lp-k">工时</span></div>
            <div class="lp-flip-row"><span class="lp-flip-p">—</span><span class="lp-k">收入</span></div>
            <div class="lp-flip-row"><span class="lp-flip-d">—</span><span class="lp-k">出勤</span></div>
            <div class="lp-flip-small">再点一下翻回去</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ACT 4 · 小票打印 -->
    <div class="lp-act lp-act-receipt">
      <h2 class="lp-h2">月底，小票打出来。</h2>
      <div class="lp-receipt">
        <div class="lp-receipt-head">工时结算单 · 2026-11</div>
        <div class="lp-row"><span>11-01 三楼取餐</span><span class="lp-rh">2.0h</span><span class="lp-rp">¥36</span></div>
        <div class="lp-row"><span>11-02 三楼取餐</span><span class="lp-rh">3.5h</span><span class="lp-rp">¥70</span></div>
        <div class="lp-row"><span>11-03 三楼取餐</span><span class="lp-rh">3.5h</span><span class="lp-rp">¥70</span></div>
        <div class="lp-row"><span>11-05 三楼取餐</span><span class="lp-rh">4.0h</span><span class="lp-rp">¥72</span></div>
        <div class="lp-row"><span>11-08 三楼取餐</span><span class="lp-rh">2.5h</span><span class="lp-rp">¥45</span></div>
        <div class="lp-row"><span>11-09 三楼取餐</span><span class="lp-rh">2.5h</span><span class="lp-rp">¥45</span></div>
        <div class="lp-row"><span>11-10 三楼取餐</span><span class="lp-rh">3.5h</span><span class="lp-rp">¥70</span></div>
        <div class="lp-row lp-row-total"><span>合计</span><span class="lp-rh">21.5h</span><span class="lp-rp">¥${DEMO.pay}</span></div>
        <div class="lp-row"><span>广告</span><span class="lp-rp lp-zero">0 次</span></div>
        <div class="lp-row"><span>跳转</span><span class="lp-rp lp-zero">0 次</span></div>
      </div>
    </div>

    <!-- ACT 5 · 三端安装 + 落章 -->
    <div class="lp-act lp-install">
      <h2 class="lp-h2">把它装进口袋。</h2>
      <div class="lp-install-cards">
        <a class="lp-inst-card" href="./work-hours.apk${location.search}" download="记工时.apk">
          <b>Android 安装包</b><span>完全离线 · 零权限 · 仅 246KB</span>
        </a>
        <button class="lp-inst-card lp-inst-start">
          <b>网页版</b><span>打开即用，可添加到主屏幕</span>
        </button>
        <div class="lp-inst-card lp-inst-ios">
          <b>iOS</b><span>Safari 打开 → 分享 → 添加到主屏幕</span>
        </div>
      </div>
      <div class="lp-stamp">零广告<span>0 次 · 0 跳转</span></div>
      <button class="lp-start-btn">开始记工时 →</button>
    </div>

    <!-- 尾声 -->
    <div class="lp-tail">
      你在这个页面停留 <span class="lp-hire-val">00:00.0</span>，按 ¥${DEMO.rate}/h 折算 <span class="lp-hire-foot">¥0.00</span>。<br>
      <b>用记工时，这些一秒都不会被漏掉。</b>
    </div>
    <div class="lp-tail-sub">纯网页应用 · 数据只存本机 · 兼容主流国产浏览器</div>
  </div>`;
}

/* 枕籍 Mockups — 交互脚本：样机即规格，控件全部真实生效 */

/* ---------- 03 阅读界面：主题切换 ---------- */
const mainReader = document.getElementById('main-reader');
document.querySelectorAll('.reader-theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.reader-theme-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    mainReader.dataset.theme = btn.dataset.t;
  });
});

/* ---------- 04 排版设置：全部控件实时生效 ---------- */
const aaReader = document.getElementById('aa-reader');
const aaText   = document.getElementById('aa-text');

/* 主题 */
document.querySelectorAll('.theme-pick .tp').forEach(tp => {
  tp.addEventListener('click', () => {
    document.querySelectorAll('.theme-pick .tp').forEach(x => x.classList.remove('on'));
    tp.classList.add('on');
    aaReader.dataset.theme = tp.dataset.t;
  });
});

/* 字体 */
const fontMap = [
  '"Noto Serif SC", "Songti SC", serif',
  '"Noto Sans SC", "PingFang SC", sans-serif',
  'system-ui, sans-serif'
];
document.querySelectorAll('.font-list button').forEach((btn, i) => {
  if (i > 2) return; // 「导入字体」为演示项
  btn.addEventListener('click', () => {
    document.querySelectorAll('.font-list button').forEach(x => x.classList.remove('on'));
    btn.classList.add('on');
    aaText.style.fontFamily = fontMap[i];
  });
});

/* 滑块（字号 / 行距） */
function bindSlider(rangeId, fillId, thumbId, min, max, apply) {
  const range = document.getElementById(rangeId);
  const fill  = document.getElementById(fillId);
  const thumb = document.getElementById(thumbId);
  const update = () => {
    const pct = ((range.value - min) / (max - min)) * 100;
    fill.style.width = pct + '%';
    thumb.style.left = pct + '%';
    apply(range.value);
  };
  range.addEventListener('input', update);
  update();
}
bindSlider('fs-range', 'fs-fill', 'fs-thumb', 14, 24, v => {
  aaText.style.setProperty('--fs', v + 'px');
});
bindSlider('lh-range', 'lh-fill', 'lh-thumb', 15, 25, v => {
  aaText.style.setProperty('--lh', (v / 10).toFixed(1));
  document.getElementById('lh-val').textContent = (v / 10).toFixed(1);
});

/* 版式：分页 / 滚动 */
const modePage   = document.getElementById('mode-page');
const modeScroll = document.getElementById('mode-scroll');
modePage.addEventListener('click', () => {
  modePage.classList.add('on'); modeScroll.classList.remove('on');
  aaText.style.columnWidth = ''; aaText.style.maxHeight = ''; aaText.style.overflowY = '';
});
modeScroll.addEventListener('click', () => {
  modeScroll.classList.add('on'); modePage.classList.remove('on');
  aaText.style.maxHeight = '420px'; aaText.style.overflowY = 'auto';
});

/* 中文排版开关 —— 直接操作真实 CSS 属性 */
function bindSwitch(id, on, off) {
  const sw = document.getElementById(id);
  const apply = () => (sw.classList.contains('on') ? on() : off());
  sw.addEventListener('click', () => { sw.classList.toggle('on'); apply(); });
  apply();
}
bindSwitch('sw-trim',
  () => { aaText.style.textSpacingTrim = 'trim-all'; },
  () => { aaText.style.textSpacingTrim = 'space-all'; });
bindSwitch('sw-space',
  () => { aaText.style.textAutospace = 'normal'; },
  () => { aaText.style.textAutospace = 'no-autospace'; });
bindSwitch('sw-kinsoku',
  () => { aaText.style.lineBreak = 'strict'; aaText.style.wordBreak = 'normal'; },
  () => { aaText.style.lineBreak = 'normal'; aaText.style.wordBreak = 'break-all'; });
bindSwitch('sw-indent',
  () => { aaText.classList.remove('no-indent'); },
  () => { aaText.classList.add('no-indent'); });

/* ---------- 06 Android：翻页热区叠加层 ---------- */
const tz = document.getElementById('tapzones');
const tzBtn = document.getElementById('tz-toggle');
tzBtn.addEventListener('click', () => {
  const hidden = tz.style.display === 'none';
  tz.style.display = hidden ? 'flex' : 'none';
  tzBtn.textContent = hidden ? '隐藏热区叠加层' : '显示热区叠加层';
});

/* ---------- 通用：chip 组单选（书库筛选等演示态） ---------- */
document.querySelectorAll('.lib-toolbar').forEach(bar => {
  bar.querySelectorAll('.chip-accent').forEach(chip => {
    chip.addEventListener('click', () => {
      bar.querySelectorAll('.chip-accent').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
    });
  });
});
document.querySelectorAll('.view-toggle').forEach(vt => {
  vt.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      vt.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
  });
});

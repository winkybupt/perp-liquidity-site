/* 主控:状态 + tab 切换 + 事件绑定(数据由 data.js 注入 window.PERP_DATA) */
(function () {
  'use strict';
  var APP = window.APP;
  var DATA = window.PERP_DATA || {};
  // 兼容一期单块 data.js(无 perp/spot 顶层):当作 perp 块
  if (!DATA.perp && DATA.latest_detail) DATA = { perp: DATA, spot: null };

  var st = {
    mode: 'perp',
    hasOi: true,
    granularity: 'day',
    depthKey: 'depth1pct_usd',
    sortKey: 'vol', sortDesc: true,
    typeFilter: 'all', searchTerm: '',
    block: function () {
      var b = DATA[st.mode];
      return b || { meta: { latest_date: null, exchanges_status: {},
                            coverage_changed: false, warnings: [] },
                    overview_series: [], exchange_series: {},
                    latest_detail: [], ticker_series: {} };
    },
  };

  var totalChart = echarts.init(document.getElementById('chart-total'));
  var shareChart = echarts.init(document.getElementById('chart-share'));
  var modalChart = null;

  function renderAll() {
    APP.renderHeader(st);
    APP.renderCards(st);
    APP.renderTotalChart(st, totalChart);
    APP.renderShareChart(st, shareChart);
    APP.renderExchangeTable(st);
    APP.renderTickerTable(st);
  }

  // ---- Perp / 现货 tab ----
  document.getElementById('mode-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.mode = btn.dataset.mode;
    st.hasOi = st.mode === 'perp';
    if (st.sortKey === 'oi' && !st.hasOi) { st.sortKey = 'vol'; st.sortDesc = true; }
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    renderAll();
  });

  // ---- 粒度 ----
  document.getElementById('granularity').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.granularity = btn.dataset.g;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    APP.renderTotalChart(st, totalChart);
    APP.renderShareChart(st, shareChart);
  });

  // ---- 明细表:排序(thead 每次重建,委托常驻) ----
  document.querySelector('#ticker-table thead').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]');
    if (!th) return;
    var key = th.dataset.sort;
    if (st.sortKey === key) { st.sortDesc = !st.sortDesc; }
    else { st.sortKey = key; st.sortDesc = true; }
    APP.renderTickerTable(st);
  });

  // ---- 明细表:展开/弹窗 ----
  document.querySelector('#ticker-table tbody').addEventListener('click', function (e) {
    var link = e.target.closest('.ticker-link');
    if (link) { openModal(link.dataset.ticker); return; }
    var row = e.target.closest('tr.main');
    if (!row) return;
    var idx = row.dataset.idx;
    var subs = this.querySelectorAll('tr.sub[data-parent="' + idx + '"]');
    var show = subs.length && subs[0].hidden;
    Array.prototype.forEach.call(subs, function (s) { s.hidden = !show; });
    row.querySelector('.expander').textContent = show ? '▾' : '▸';
  });

  // ---- 筛选/搜索/深度口径 ----
  document.getElementById('type-filter').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.typeFilter = btn.dataset.t;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    APP.renderTickerTable(st);
  });
  document.getElementById('search').addEventListener('input', function () {
    st.searchTerm = this.value.trim();
    APP.renderTickerTable(st);
  });
  document.getElementById('depth-scope').addEventListener('change', function () {
    st.depthKey = this.value;
    APP.renderTickerTable(st);
  });

  // ---- 弹窗 ----
  function openModal(ticker) {
    document.getElementById('modal-title').textContent =
      ticker + ' · 历史趋势(日)';
    document.getElementById('modal').hidden = false;
    if (!modalChart) modalChart = echarts.init(document.getElementById('modal-chart'));
    APP.renderModalChart(st, modalChart, ticker);
    setTimeout(function () { modalChart.resize(); }, 0);
  }
  document.getElementById('modal-close').addEventListener('click', function () {
    document.getElementById('modal').hidden = true;
  });
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target === this) this.hidden = true;
  });

  window.addEventListener('resize', function () {
    totalChart.resize(); shareChart.resize();
    if (modalChart) modalChart.resize();
  });

  // ---- 页脚 ----
  var warnBox = document.getElementById('warnings');
  var meta = st.block().meta;
  (meta.warnings || []).forEach(function (w) {
    var p = document.createElement('p');
    p.className = 'warn-line';
    p.textContent = '⚠ ' + w;
    warnBox.appendChild(p);
  });
  document.getElementById('generated-at').textContent =
    meta.generated_at ? '数据生成时间:' + meta.generated_at : '';

  renderAll();
})();

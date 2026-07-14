/* 主控:状态 + tab 切换 + 事件绑定(数据由 data.js 注入 window.PERP_DATA) */
(function () {
  'use strict';
  var APP = window.APP;
  var DATA = window.PERP_DATA || {};
  // 兼容一期单块 data.js(无 perp/spot 顶层):当作 perp 块
  if (!DATA.perp && DATA.latest_detail) DATA = { perp: DATA, spot: null };

  var dayCache = {};   // date → {perp: [...], spot: [...]}(days/ 切片)
  var st = {
    mode: 'perp',
    hasOi: true,
    granularity: 'day',
    depthKey: 'depth1pct_usd',
    sortKey: 'vol', sortDesc: true,
    typeFilter: 'all', searchTerm: '',
    selectedDate: null,   // null = 最新日
    dateIndex: function (series) {
      if (!st.selectedDate) return series.length - 1;
      for (var i = series.length - 1; i >= 0; i--) {
        if (series[i].date === st.selectedDate) return i;
      }
      return series.length - 1;
    },
    currentDetail: function () {
      if (!st.selectedDate) return st.block().latest_detail;
      var day = dayCache[st.selectedDate];
      return day ? (day[st.mode] || []) : [];
    },
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
    APP.renderFooterMeta(st);
    APP.renderHeader(st);
    APP.renderCards(st);
    APP.renderTotalChart(st, totalChart);
    APP.renderShareChart(st, shareChart);
    APP.renderExchangeTable(st);
    APP.renderTickerTable(st);
  }

  // ---- 日期选择(days/ 切片懒加载;file:// 用 script 注入)----
  var datePick = document.getElementById('date-pick');
  var allDates = (DATA.perp && DATA.perp.meta.available_dates) || [];
  if (allDates.length) {
    datePick.min = allDates[0];
    datePick.max = allDates[allDates.length - 1];
    datePick.value = allDates[allDates.length - 1];
  }
  window.__PERP_DAY_CB = function (detail) {
    dayCache[detail.date] = detail;
    if (st.selectedDate === detail.date) renderAll();
  };
  function loadDay(date) {
    // 正则 + available_dates 白名单双校验后才进 script src
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || allDates.indexOf(date) === -1) {
      st.selectedDate = null;
      renderAll();
      return;
    }
    st.selectedDate = (date === allDates[allDates.length - 1]) ? null : date;
    if (!st.selectedDate || dayCache[date]) { renderAll(); return; }
    var tag = document.createElement('script');
    tag.src = 'days/' + date + '.js';
    var done = false;
    function fail() {
      if (done || dayCache[date]) return;
      done = true;
      dayCache[date] = { date: date, perp: [], spot: [] };
      renderAll();   // 空明细 → 表格显示"无数据"
    }
    tag.onload = function () { setTimeout(fail, 100); };  // onload 后回调未置数=坏片
    tag.onerror = fail;
    setTimeout(fail, 4000);                               // file:// onerror 不可靠,超时兜底
    document.body.appendChild(tag);
    renderAll();
  }
  datePick.addEventListener('change', function () { loadDay(this.value); });

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

  renderAll();
})();

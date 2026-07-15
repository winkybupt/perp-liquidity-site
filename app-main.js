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
    detailMode: 'day',   // 明细表:day=日快照(联动日期框)| live=最新时点(4h)
    shareStack: 'line',  // 份额图:line=独立折线(默认)| stack=堆叠
    depthKey: 'depth_l3_usd',
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
      if (st.detailMode === 'live') {
        // 双兜底:旧 data.js 的 intraday 块可能没有 latest_detail 键,
        // undefined 会让 renderTickerTable 直接 throw(===null 才是加载中)
        var blk = st.intraday()[st.mode === 'spot' ? 'spot' : 'perp'] || {};
        return blk.latest_detail || [];
      }
      if (!st.selectedDate) return st.block().latest_detail;
      var day = dayCache[st.selectedDate];
      return day ? (day[st.mode] || []) : null;   // null = 加载中
    },
    block: function () {
      var b = DATA[st.mode];
      return b || { meta: { latest_date: null, exchanges_status: {},
                            coverage_changed: false, warnings: [] },
                    overview_series: [], exchange_series: {},
                    latest_detail: [], ticker_series: {} };
    },
    intraday: function () {   // v4 顶层块(旧 data.js 无此块时给空结构)
      return DATA.intraday ||
        { meta: { latest_snap_ts: null, grid_ts: [], hour_ts: [] },
          perp: { oi_total: [], oi_by_exchange: {}, spread_by_exchange: {},
                  vol_total: [], vol_by_exchange: {}, latest_detail: [] },
          spot: { spread_by_exchange: {}, vol_total: [],
                  vol_by_exchange: {}, latest_detail: [] } };
    },
  };

  var totalChart = echarts.init(document.getElementById('chart-total'));
  var shareChart = echarts.init(document.getElementById('chart-share'));
  var intradayOiChart = echarts.init(document.getElementById('chart-intraday-oi'));
  var intradaySpreadChart = echarts.init(document.getElementById('chart-intraday-spread'));
  var modalChart = null;
  var modalHourChart = null;
  var modalTicker = null;   // 弹窗打开中的标的(切片迟到时补渲小时图)

  function renderAll() {
    APP.renderFooterMeta(st);
    APP.renderHeader(st);
    APP.renderCards(st);
    APP.renderTotalChart(st, totalChart);
    APP.renderShareChart(st, shareChart);
    APP.renderIntradayPanel(st, intradayOiChart, intradaySpreadChart);
    APP.renderExchangeTable(st);
    APP.renderTickerTable(st);
  }

  // ---- 日期选择(days/ 切片懒加载;file:// 用 script 注入)----
  var datePick = document.getElementById('date-pick');
  var allDates = (function () {   // perp ∪ spot(spot-only 日期也可选)
    var a = (DATA.perp && DATA.perp.meta.available_dates) || [];
    var b = (DATA.spot && DATA.spot.meta.available_dates) || [];
    var seen = {};
    return a.concat(b).filter(function (d) {
      if (seen[d]) return false;
      seen[d] = true;
      return true;
    }).sort();
  })();
  var pendingDays = {};   // 在途请求防重复 append
  if (allDates.length) {
    datePick.min = allDates[0];
    datePick.max = allDates[allDates.length - 1];
    datePick.value = allDates[allDates.length - 1];
  }
  function modalDate() {   // 弹窗小时图取数日:所选日,最新日兜底
    return st.selectedDate || allDates[allDates.length - 1] || null;
  }
  function refreshModalHour() {
    if (!modalTicker) return;
    var d = modalDate();
    var slice = d ? dayCache[d] : null;
    if (!slice || slice.failed) {
      document.getElementById('modal-hour-box').hidden = true;
      return;
    }
    if (!modalHourChart) {
      modalHourChart = echarts.init(document.getElementById('modal-hour-chart'));
    }
    if (APP.renderModalHour(st, modalHourChart, modalTicker, slice)) {
      setTimeout(function () { modalHourChart.resize(); }, 0);
    }
  }
  window.__PERP_DAY_CB = function (detail) {
    dayCache[detail.date] = detail;
    delete pendingDays[detail.date];
    if (st.selectedDate === detail.date) renderAll();
    if (modalTicker && modalDate() === detail.date) refreshModalHour();
  };
  function ensureSlice(date) {
    // 正则 + available_dates 白名单双校验后才进 script src(调用方已校验,
    // 此处再兜一道,弹窗路径同享防御)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || allDates.indexOf(date) === -1) return;
    var cached = dayCache[date];
    if (cached && cached.failed) { delete dayCache[date]; cached = null; }  // 失败片可重试
    if (cached || pendingDays[date]) return;               // 在途防重复 append
    pendingDays[date] = true;
    var tag = document.createElement('script');
    tag.src = 'days/' + date + '.js';
    var done = false;
    function cleanup() { if (tag.parentNode) tag.parentNode.removeChild(tag); }
    function fail() {
      if (done || dayCache[date]) { cleanup(); return; }
      done = true;
      delete pendingDays[date];
      dayCache[date] = { date: date, perp: [], spot: [], failed: true };
      cleanup();
      // 只在失败片仍是当前所选日时才全页重渲——迟到的旧日期失败
      // 不该重置用户已展开的表格交互态
      if (st.selectedDate === date) renderAll();
      refreshModalHour();
    }
    tag.onload = function () { setTimeout(function () { fail(); cleanup(); }, 100); };
    tag.onerror = fail;
    setTimeout(fail, 4000);                               // file:// onerror 不可靠,超时兜底
    document.body.appendChild(tag);
  }
  function loadDay(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || allDates.indexOf(date) === -1) {
      st.selectedDate = null;
      datePick.value = allDates[allDates.length - 1] || '';  // 拒绝时回写,输入框与视图不脱钩
      renderAll();
      return;
    }
    st.selectedDate = (date === allDates[allDates.length - 1]) ? null : date;
    if (st.selectedDate) ensureSlice(date);
    renderAll();                                          // pending 态渲染"加载中…"
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

  // ---- 份额图 堆叠/独立 切换 ----
  document.getElementById('share-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.shareStack = btn.dataset.sm;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    APP.renderShareChart(st, shareChart);
  });

  // ---- 明细表 日快照/最新时点 切换 ----
  document.getElementById('detail-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.detailMode = btn.dataset.dm;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    APP.renderTickerTable(st);
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
    // v4:选中日(含最新日)切片有小时数据时补小时成交柱 + 4h OI 折线
    modalTicker = ticker;
    document.getElementById('modal-hour-box').hidden = true;
    var d = modalDate();
    if (d) {
      if (dayCache[d] && !dayCache[d].failed) refreshModalHour();
      else ensureSlice(d);
    }
  }
  function closeModal() {
    document.getElementById('modal').hidden = true;
    modalTicker = null;
  }
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  window.addEventListener('resize', function () {
    totalChart.resize(); shareChart.resize();
    intradayOiChart.resize(); intradaySpreadChart.resize();
    if (modalChart) modalChart.resize();
    if (modalHourChart) modalHourChart.resize();
  });

  renderAll();
})();

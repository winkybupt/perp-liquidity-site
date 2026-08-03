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
    shareMetric: 'vol',  // 份额图:vol=成交额(默认)| oi=持仓(仅 perp)
    shareStack: 'line',  // 份额图:line=独立折线(默认)| stack=堆叠
    shareValue: 'amount', // 份额图:amount=美元成交额(默认)| percent=时间桶占比
    depthKey: 'depth_l3_usd',
    sortKey: 'vol', sortDesc: true,
    typeFilter: 'all', searchTerm: '',
    detailPage: 1, detailPageSize: 20, detailTotalPages: 1,
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
    rankDate: function () { return datePick.value || null; },
    rankDetail: function () {
      var date = st.rankDate();
      var block = st.block();
      if (!date) return [];
      if (date === block.meta.latest_date) return block.latest_detail || [];
      var day = dayCache[date];
      return day && !day.failed ? (day[st.mode] || []) : null;
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
  var tradfiChart = echarts.init(document.getElementById('chart-tradfi'));
  var intradayOiChart = echarts.init(document.getElementById('chart-intraday-oi'));
  var intradaySpreadChart = echarts.init(document.getElementById('chart-intraday-spread'));
  var modalChart = null;
  var modalHourChart = null;
  var modalFundingChart = null;
  var modalTicker = null;   // 弹窗打开中的标的(切片迟到时补渲小时图)
  var rankState = null;
  var rankTrigger = null;
  var rankFocusPending = null;
  var rankFocusFallback = null;
  var rankInertElements = [];
  var scheduleShareRender = APP.createFrameScheduler(
    function (callback) { window.requestAnimationFrame(callback); },
    function () { APP.renderShareChart(st, shareChart); }
  );

  function syncShareControls() {
    var metric = APP.effectiveShareMetric(st);
    var metricMode = document.getElementById('share-metric-mode');
    metricMode.querySelectorAll('button').forEach(function (button) {
      var active = button.dataset.smetric === metric;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('share-metric-oi').hidden = !st.hasOi;
    // 小时成交保留既有金额口径；小时 OI 可使用金额/占比。
    document.getElementById('share-value-mode').hidden =
      st.granularity === 'hour' && metric !== 'oi';
  }

  function renderAll() {
    syncShareControls();
    APP.renderFooterMeta(st);
    APP.renderHeader(st);
    APP.renderCards(st);
    APP.renderTotalChart(st, totalChart);
    APP.renderShareChart(st, shareChart);
    APP.renderTradfiChart(st, tradfiChart);
    APP.renderIntradayPanel(st, intradayOiChart, intradaySpreadChart);
    APP.renderExchangeTable(st);
    APP.renderTickerTable(st);
    restoreRankFocus();
  }
  function resetDetailPage() { st.detailPage = 1; }

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
    // 已超时/失败的旧 script 即使迟到也不能复活失败片；显式重试会先
    // 重新设置 pendingDays，因此仍可正常接收新请求的回调。
    if (!pendingDays[detail.date] && dayCache[detail.date] &&
        dayCache[detail.date].failed) return;
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
    closeRankModal(datePick);
    resetDetailPage();
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
    closeRankModal(btn);
    st.mode = btn.dataset.mode;
    resetDetailPage();
    st.hasOi = st.mode === 'perp';
    if ((st.sortKey === 'oi' || st.sortKey === 'funding_8h') && !st.hasOi) {
      st.sortKey = 'vol'; st.sortDesc = true;   // spot 无 OI/funding 列,排序键复位
    }
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    // depth-export 控件仅 perp 可见(文件可用时)
    var depthBox = document.getElementById('depth-export');
    if (depthBox && depthBox.dataset.fileAvailable === 'true') {
      depthBox.hidden = st.mode !== 'perp';
    }
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
    syncShareControls();
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
    resetDetailPage();
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

  // ---- 明细表:分页(按钮列表每次重建,委托常驻) ----
  document.getElementById('ticker-pagination').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    var page = APP.pageTarget(btn.dataset.page, st.detailTotalPages);
    if (page === null || page === st.detailPage) return;
    st.detailPage = page;
    APP.renderTickerTable(st);
    var current = this.querySelector('button[aria-current="page"]');
    if (current) current.focus();
  });

  // ---- 数据源拆分 Top 20 矩阵 ----
  document.getElementById('rank-open').addEventListener('click', function () {
    if (!this.disabled) openRankModal(this);
  });
  document.getElementById('rank-metric-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-rank-metric]');
    if (!btn || btn.hidden || !rankState) return;
    rankState.metric = btn.dataset.rankMetric;
    rankState = APP.renderRankModal(st, rankState);
  });
  document.getElementById('rank-coverage-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-rank-coverage]');
    if (!btn || btn.hidden || !rankState) return;
    rankState.minCoverage = Number(btn.dataset.rankCoverage);
    rankState = APP.renderRankModal(st, rankState);
  });
  document.getElementById('rank-search').addEventListener('input', function () {
    if (!rankState) return;
    rankState.search = this.value;
    rankState = APP.renderRankModal(st, rankState);
  });
  document.getElementById('rank-sort').addEventListener('change', function () {
    if (!rankState) return;
    rankState.sort = this.value;
    rankState = APP.renderRankModal(st, rankState);
  });
  ['a', 'b'].forEach(function (slot, index) {
    document.getElementById('rank-exchange-' + slot).addEventListener('change', function () {
      if (!rankState) return;
      rankState.mobileExchanges[index] = this.value;
      rankState = APP.renderRankModal(st, rankState);
    });
  });

  // ---- 份额图 成交额/OI 切换 ----
  document.getElementById('share-metric-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || btn.hidden || st.shareMetric === btn.dataset.smetric) return;
    st.shareMetric = btn.dataset.smetric;
    syncShareControls();
    scheduleShareRender();
  });

  // ---- 份额图 堆叠/独立 切换 ----
  document.getElementById('share-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || st.shareStack === btn.dataset.sm) return;
    st.shareStack = btn.dataset.sm;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    scheduleShareRender();
  });

  // ---- 份额图 金额/占比；小时成交专属隐藏，小时 OI 可切换 ----
  document.getElementById('share-value-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || st.shareValue === btn.dataset.sv) return;
    st.shareValue = btn.dataset.sv;
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    scheduleShareRender();
  });

  // ---- 明细表 日快照/最新时点 切换 ----
  document.getElementById('detail-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    st.detailMode = btn.dataset.dm;
    resetDetailPage();
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
    resetDetailPage();
    this.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b === btn);
    });
    APP.renderTickerTable(st);
  });
  document.getElementById('search').addEventListener('input', function () {
    st.searchTerm = this.value.trim();
    resetDetailPage();
    APP.renderTickerTable(st);
  });
  document.getElementById('depth-scope').addEventListener('change', function () {
    st.depthKey = this.value;
    resetDetailPage();
    APP.renderTickerTable(st);
  });

  // ---- 弹窗 ----
  function setRankBackgroundInert(active) {
    if (active) {
      rankInertElements = [];
      Array.prototype.forEach.call(document.body.children, function (element) {
        if (element.id === 'rank-modal' || element.inert) return;
        element.inert = true;
        rankInertElements.push(element);
      });
      return;
    }
    rankInertElements.forEach(function (element) { element.inert = false; });
    rankInertElements = [];
  }
  function trapRankFocus(e) {
    if (e.key !== 'Tab') return;
    var modal = document.getElementById('rank-modal');
    var dialog = modal.querySelector('[role="dialog"]');
    var focusable = Array.prototype.filter.call(
      dialog.querySelectorAll(
        'button:not([hidden]):not([disabled]), [href], input:not([disabled]), ' +
        'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (element) { return !element.hidden; }
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first ||
                       !dialog.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function rankIsMobile() { return window.innerWidth < 720; }
  function openRankModal(trigger) {
    closeModal();
    rankFocusPending = null;
    rankFocusFallback = null;
    rankTrigger = trigger;
    rankState = { metric: 'vol', search: '', minCoverage: 1,
      sort: 'total', mobile: rankIsMobile(), mobileExchanges: [] };
    document.getElementById('rank-modal').hidden = false;
    setRankBackgroundInert(true);
    rankState = APP.renderRankModal(st, rankState);
    document.getElementById('rank-modal-close').focus();
  }
  function closeRankModal(fallback) {
    var modal = document.getElementById('rank-modal');
    if (modal.hidden) return;
    modal.hidden = true;
    rankState = null;
    setRankBackgroundInert(false);
    var trigger = rankTrigger;
    rankTrigger = null;
    // 历史切片加载时入口暂时 disabled；等后续 renderAll 重新启用后再恢复。
    rankFocusPending = trigger;
    rankFocusFallback = fallback || null;
    if (trigger) setTimeout(restoreRankFocus, 0);
  }
  function restoreRankFocus() {
    if (!rankFocusPending) return;
    if (rankFocusPending.disabled) {
      // 历史切片尚在加载时继续等待；确定无入口后回到上下文切换控件。
      if (st.selectedDate && !dayCache[st.selectedDate]) return;
      if (rankFocusFallback && !rankFocusFallback.disabled) {
        rankFocusFallback.focus();
      }
    } else {
      rankFocusPending.focus();
    }
    rankFocusPending = null;
    rankFocusFallback = null;
  }
  document.getElementById('rank-modal-close').addEventListener('click', closeRankModal);
  document.getElementById('rank-modal').addEventListener('click', function (e) {
    if (e.target === this) closeRankModal();
  });
  window.addEventListener('keydown', function (e) {
    if (document.getElementById('rank-modal').hidden) return;
    if (e.key === 'Escape') closeRankModal();
    else trapRankFocus(e);
  });

  function openModal(ticker) {
    closeRankModal();
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
    // funding-stats:费率日线(perp 专属,无数据票隐藏面板)
    var fundingBox = document.getElementById('modal-funding-box');
    if (st.hasOi) {
      if (!modalFundingChart) {
        modalFundingChart = echarts.init(
          document.getElementById('modal-funding-chart'));
      }
      var hasFunding = APP.renderModalFunding(st, modalFundingChart, ticker);
      fundingBox.hidden = !hasFunding;
      if (hasFunding) setTimeout(function () { modalFundingChart.resize(); }, 0);
    } else {
      fundingBox.hidden = true;
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
    totalChart.resize(); shareChart.resize(); tradfiChart.resize();
    scheduleShareRender();
    intradayOiChart.resize(); intradaySpreadChart.resize();
    if (modalChart) modalChart.resize();
    if (modalHourChart) modalHourChart.resize();
    if (modalFundingChart) modalFundingChart.resize();
    if (rankState && rankState.mobile !== rankIsMobile()) {
      rankState.mobile = rankIsMobile();
      rankState = APP.renderRankModal(st, rankState);
    }
  });

  // ---- 深度明细 CSV 下载(docs/depth-export) ----
  // 文件仅 :8000 侧生成;Pages/file:// 探测不到即控件保持隐藏
  (function () {
    var SRC = 'exports/perp_depth_7d.csv';
    var box = document.getElementById('depth-export');
    var daysInput = document.getElementById('depth-export-days');
    var btn = document.getElementById('depth-export-btn');
    if (!box) return;
    if (window.location.protocol === 'file:') return;
    fetch(SRC, { method: 'HEAD' }).then(function (resp) {
      if (resp.ok) {
        box.dataset.fileAvailable = 'true';
        box.hidden = st.mode !== 'perp';
      }
    }).catch(function () { /* 探测失败保持隐藏 */ });

    // 纯函数:保留表头 + snap_ts_bj 属最近 n 个北京日(含今日)的行。
    // "今日"以文件内最大 snap_ts_bj 日期为锚——不读客户端时钟,消除
    // 非 UTC+8 时区错窗与北京午夜空窗(n>=7 时调用方跳过本函数)
    function filterRecentBjDays(text, n) {
      var nl = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';  // csv.writer 默认 \r\n
      var lines = text.split(nl);
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      var col = lines.length ? lines[0].split(',').indexOf('snap_ts_bj') : -1;
      if (col === -1) return text;              // 结构异常,原样返回
      var maxDate = '';
      var i, d;
      for (i = 1; i < lines.length; i++) {
        d = lines[i].split(',')[col];
        if (d && d.slice(0, 10) > maxDate) maxDate = d.slice(0, 10);
      }
      if (!maxDate) return text;
      var t = new Date(maxDate + 'T00:00:00Z');
      t.setUTCDate(t.getUTCDate() - (n - 1));
      var cutoff = t.toISOString().slice(0, 10);
      var out = lines.filter(function (line, idx) {
        if (idx === 0) return true;
        var v = line.split(',')[col];
        return v && v.slice(0, 10) >= cutoff;
      });
      return out.join(nl) + nl;
    }

    btn.addEventListener('click', function () {
      var n = Math.min(7, Math.max(1, parseInt(daysInput.value, 10) || 3));
      daysInput.value = n;                      // 越界输入钳制回写
      btn.disabled = true;
      fetch(SRC).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      }).then(function (text) {
        var blob = new Blob([n >= 7 ? text : filterRecentBjDays(text, n)],
                            { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'perp_depth_' + n + 'd.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }).catch(function () {
        alert('下载失败,请稍后重试');
      }).then(function () { btn.disabled = false; });
    });
  })();

  APP.renderListings();   // 静态双市场面板,渲一次即可
  renderAll();
})();

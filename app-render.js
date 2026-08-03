/* 渲染层:所有渲染函数按当前数据块(perp/spot)参数化;状态由 app-main.js 持有 */
(function () {
  'use strict';
  var APP = window.APP;
  var esc = APP.esc, fmtUsd = APP.fmtUsd, fmtPrice = APP.fmtPrice,
      fmtDelta = APP.fmtDelta, fmtBps = APP.fmtBps;

  function axisStyle(fmt) {
    // fmt:可选 y 轴标签格式化函数。必须从这里传——调用方若自带 axisLabel
    // 再 Object.assign 本函数返回值,axisLabel 会被整体覆盖(v3 曾因此
    // 所有 y 轴丢 $ 格式化,v4 页面真机核对时发现)
    return { axisLine: { lineStyle: { color: '#2d333b' } },
             splitLine: { lineStyle: { color: '#21262d' } },
             axisLabel: fmt ? { color: '#8b949e', formatter: fmt }
                            : { color: '#8b949e' } };
  }
  var dark = { backgroundColor: 'transparent',
    textStyle: { color: '#8b949e' },
    tooltip: { trigger: 'axis', backgroundColor: '#161b22',
               borderColor: '#2d333b', textStyle: { color: '#e6edf3' } } };
  APP.axisStyle = axisStyle;
  APP.darkTheme = dark;

  function matrixExchanges(st, detail) {
    var seen = Object.create(null);
    var exchanges = Object.keys(st.block().exchange_series || {});
    exchanges.forEach(function (exchange) { seen[exchange] = true; });
    (detail || []).forEach(function (row) {
      (row.exchanges || []).forEach(function (venue) {
        if (seen[venue.exchange]) return;
        seen[venue.exchange] = true;
        exchanges.push(venue.exchange);
      });
    });
    return exchanges;
  }

  APP.renderHeader = function (st) {
    var meta = st.block().meta;
    var snapTs = (st.intraday && st.intraday().meta.latest_snap_ts) || null;
    document.getElementById('meta-line').textContent =
      meta.latest_date
        ? (st.selectedDate
           ? '当前查看:' + st.selectedDate + '(最新 ' + meta.latest_date + ')'
           : '最新快照日(UTC):' + meta.latest_date
             + (snapTs ? ' · 最新时点 ' + APP.beijingTs(snapTs) + '(北京)' : ''))
        : '暂无数据,请先运行 run_daily.py';
    var chips = document.getElementById('status-chips');
    chips.innerHTML = '';
    Object.keys(meta.exchanges_status || {}).forEach(function (ex) {
      var s = meta.exchanges_status[ex];
      var el = document.createElement('span');
      el.className = 'chip ' + (s.ok ? 'ok' : 'fail');
      el.textContent = (APP.EX_NAMES[ex] || ex) + (s.ok ? ' · ' + s.count : ' · 失败');
      if (!s.ok) el.title = s.error || '';
      chips.appendChild(el);
    });
  };

  APP.renderCards = function (st) {
    var ov = st.block().overview_series;
    var idx = st.dateIndex(ov);
    var last = ov[idx] || {};
    var prev = idx > 0 ? ov[idx - 1] : {};
    var flagged = !!st.block().meta.coverage_changed;
    var cards = [
      { label: (st.hasOi ? '全市场日成交' : '现货日成交'),
        value: fmtUsd(last.vol), delta: fmtDelta(last.vol, prev.vol, flagged) },
    ];
    if (st.hasOi) {
      cards.push({ label: '全市场持仓 OI', value: fmtUsd(last.oi),
                   delta: fmtDelta(last.oi, prev.oi, flagged) });
    }
    cards.push(
      { label: '活跃标的数', value: last.tickers !== undefined ? last.tickers : '—',
        delta: fmtDelta(last.tickers, prev.tickers, flagged) },
      { label: '覆盖数据源', value: last.exchanges !== undefined ? last.exchanges : '—',
        delta: '' });
    document.getElementById('cards').innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="label">' + c.label + '</div>' +
             '<div class="value">' + c.value + '</div>' +
             '<div class="delta-row">' + (c.delta || '&nbsp;') + '</div></div>';
    }).join('');
  };

  APP.renderTotalChart = function (st, chart) {
    if (st.granularity === 'hour') { APP.renderHourlyTotal(st, chart); return; }
    var rows = APP.aggregate(st.block().overview_series, st.granularity,
                             st.block().meta.latest_date);
    var series = [{ name: '成交', type: 'bar',
      data: rows.map(function (r) { return r.vol; }),
      itemStyle: { color: '#58a6ff' }, barMaxWidth: 26 }];
    var yAxes = [Object.assign({ type: 'value', name: '成交' },
                               axisStyle(fmtUsd))];
    if (st.hasOi) {
      yAxes.push(Object.assign({ type: 'value', name: 'OI' },
                               axisStyle(fmtUsd), { splitLine: { show: false } }));
      series.push({ name: 'OI', type: 'line', yAxisIndex: 1, smooth: true,
        data: rows.map(function (r) { return r.oi; }),
        itemStyle: { color: '#d29922' }, lineStyle: { width: 2 } });
    }
    chart.setOption({
      backgroundColor: dark.backgroundColor, textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: fmtUsd }),
      legend: { data: series.map(function (s) { return s.name; }),
                textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 60, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category',
        data: rows.map(function (r) { return r.label; }) }, axisStyle()),
      yAxis: yAxes, series: series,
    }, true);
  };

  APP.renderShareChart = function (st, chart) {
    if (st.granularity === 'hour') { APP.renderHourlyShare(st, chart); return; }
    var es = st.block().exchange_series;
    var names = Object.keys(es);
    var rows = APP.aggregate(st.block().overview_series, st.granularity,
                             st.block().meta.latest_date);
    var labels = rows.map(function (r) { return r.label; });
    var stacked = st.shareStack !== 'line';
    var percent = st.shareValue === 'percent';
    var metric = APP.effectiveShareMetric(st);
    var raw = names.map(function (ex) {
      var agg = APP.aggregateShare(es[ex], st.granularity,
                                   st.block().meta.latest_date);
      var byLabel = {};
      agg.forEach(function (r) { byLabel[r.label] = r[metric]; });
      return labels.map(function (l) {
        var v = byLabel[l];
        return (v === undefined || v === null) ? null : v;
      });
    });
    var totals = labels.map(function (_, idx) {
      return raw.reduce(function (sum, values) {
        return values[idx] === null ? sum : sum + values[idx];
      }, 0);
    });
    var series = names.map(function (ex, i) {
      var values = raw[i].map(function (v, idx) {
        if (v === null) return stacked ? 0 : null;
        if (!percent) return v;
        return totals[idx] ? v / totals[idx] * 100 : 0;
      });
      return { name: APP.EX_NAMES[ex] || ex, type: 'line',
               stack: stacked ? (percent ? 'share' : metric) : undefined,
               areaStyle: stacked ? { opacity: .35 } : undefined,
               smooth: true, symbol: 'none',
               itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
               data: values };
    });
    chart.setOption({
      animation: false,
      backgroundColor: dark.backgroundColor, textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: function (v) {
        return APP.fmtShareValue(v, percent);
      } }),
      legend: { textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 20, top: APP.shareGridTop(chart), bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: labels }, axisStyle()),
      yAxis: Object.assign({ type: 'value', max: percent ? 100 : undefined },
                           axisStyle(percent ? function (v) { return v + '%'; }
                                             : fmtUsd)),
      series: series,
    }, true);
  };

  APP.renderExchangeTable = function (st) {
    var es = st.block().exchange_series;
    var latest = st.block().meta.latest_date;
    var thead = document.querySelector('#exchange-table thead');
    thead.innerHTML = '<tr><th>数据源</th><th class="num">日成交</th>' +
      '<th class="num">环比</th>' +
      (st.hasOi ? '<th class="num">持仓 OI</th><th class="num">环比</th>' : '') +
      '<th class="num" title="该所 TradFi 成交占其全市场总量(含加密)的百分比;分母来自 CoinGecko">TradFi 占比</th>' +
      '<th class="num">标的数</th></tr>';
    var tbody = document.querySelector('#exchange-table tbody');
    var target = st.selectedDate || latest;
    var share = st.block().tradfi_share || { dates: [], by_exchange: {} };
    var shareIdx = share.dates.indexOf(target);
    var exactDetail = st.rankDetail();
    var entry = document.getElementById('rank-open');
    var entryMatrix = exactDetail === null ? null : APP.buildExchangeMatrix(
      exactDetail || [], matrixExchanges(st, exactDetail), 'vol');
    entry.disabled = !entryMatrix || entryMatrix.exchanges.length === 0;
    entry.title = entry.disabled ? '所选日期暂无可比较的成交排行' :
      '比较各交易所 Top 20 标的';
    function shareCell(ex, stale) {
      if (stale || shareIdx === -1) return '—';
      var v = (share.by_exchange[ex] || [])[shareIdx];
      return (v === null || v === undefined) ? '—' : v.toFixed(2) + '%';
    }
    var rows = Object.keys(es).map(function (ex) {
      var s = es[ex];
      var i = -1;
      for (var k = s.length - 1; k >= 0; k--) {
        if (s[k].date <= target) { i = k; break; }
      }
      var cur = i >= 0 ? s[i] : null;
      var prv = i > 0 ? s[i - 1] : {};
      var stale = !!cur && cur.date !== target;
      return { ex: ex, cur: cur || {}, prv: prv, stale: stale,
               absent: !cur };
    }).sort(function (a, b) { return (b.cur.vol || 0) - (a.cur.vol || 0); });
    tbody.innerHTML = rows.map(function (r) {
      if (r.absent) {   // 目标日之前该源完全无数据(未上线/未回填)
        return '<tr class="main"><td>' + esc(APP.EX_NAMES[r.ex] || r.ex) +
          ' <span class="na">该日无数据</span></td><td class="num">—</td>' +
          '<td class="num">—</td>' +
          (st.hasOi ? '<td class="num">—</td><td class="num">—</td>' : '') +
          '<td class="num">—</td><td class="num">—</td></tr>';
      }
      var name = esc(APP.EX_NAMES[r.ex] || r.ex) +
        (r.stale ? ' <span class="tag" title="该日无此源数据,显示其最近一个有数据日">数据: ' +
                   esc(r.cur.date) + '</span>' : '');
      var cells = '<tr class="main"><td>' + name + '</td>' +
        '<td class="num">' + fmtUsd(r.cur.vol) + '</td>' +
        '<td class="num">' + (r.stale ? '—' : fmtDelta(r.cur.vol, r.prv.vol)) + '</td>';
      if (st.hasOi) {
        cells += '<td class="num">' + fmtUsd(r.cur.oi) + '</td>' +
          '<td class="num">' + (r.stale ? '—' : fmtDelta(r.cur.oi, r.prv.oi)) + '</td>';
      }
      return cells +
        '<td class="num">' + shareCell(r.ex, r.stale) + '</td>' +
        '<td class="num">' + (r.cur.count || 0) + '</td></tr>';
    }).join('');
  };

  APP.renderRankModal = function (st, state) {
    var effective = st.hasOi && state.metric === 'oi' ? 'oi' : 'vol';
    var date = st.rankDate();
    var detail = st.rankDetail() || [];
    var matrix = APP.buildExchangeMatrix(
      detail, matrixExchanges(st, detail), effective);
    var mobile = !!state.mobile;
    var selected = (state.mobileExchanges || []).filter(function (exchange, index, all) {
      return matrix.exchanges.indexOf(exchange) !== -1 && all.indexOf(exchange) === index;
    });
    matrix.exchanges.forEach(function (exchange) {
      if (selected.length < 2 && selected.indexOf(exchange) === -1) selected.push(exchange);
    });
    selected = selected.slice(0, 2);
    var visible = mobile ? selected : matrix.exchanges.slice();
    var minCoverage = Math.max(1, Number(state.minCoverage) || 1);
    if (mobile) minCoverage = Math.min(minCoverage, Math.max(1, visible.length));
    var sort = state.sort || 'total';
    if (sort !== 'total' && sort !== 'coverage' && visible.indexOf(sort) === -1) {
      sort = 'total';
    }
    var rows = APP.matrixView(matrix, visible, {
      search: state.search, minCoverage: minCoverage, sort: sort
    });
    var market = st.hasOi ? 'Perp' : '现货';
    document.getElementById('rank-modal-title').textContent =
      market + ' · ' + date + ' · ' +
      (effective === 'oi' ? 'OI' : '成交额') + '标的矩阵';
    var volButton = document.getElementById('rank-metric-vol');
    var oiButton = document.getElementById('rank-metric-oi');
    oiButton.hidden = !st.hasOi;
    [volButton, oiButton].forEach(function (button) {
      var active = button.dataset.rankMetric === effective;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('rank-search').value = state.search || '';
    document.querySelectorAll('[data-rank-coverage]').forEach(function (button) {
      var value = Number(button.dataset.rankCoverage);
      var active = value === minCoverage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('rank-coverage-three').hidden = mobile;
    var sortSelect = document.getElementById('rank-sort');
    sortSelect.innerHTML = '<option value="total">综合' +
      (effective === 'oi' ? ' OI' : '成交额') + '</option>' +
      '<option value="coverage">覆盖交易所数</option>' +
      visible.map(function (exchange) {
        return '<option value="' + esc(exchange) + '">' +
          esc(APP.EX_NAMES[exchange] || exchange) + '</option>';
      }).join('');
    sortSelect.value = sort;
    var mobileBox = document.getElementById('rank-mobile-exchanges');
    mobileBox.hidden = !mobile;
    ['a', 'b'].forEach(function (slot, index) {
      var select = document.getElementById('rank-exchange-' + slot);
      var options = matrix.exchanges.length
        ? matrix.exchanges.map(function (exchange) {
          return '<option value="' + esc(exchange) + '">' +
            esc(APP.EX_NAMES[exchange] || exchange) + '</option>';
        }).join('') : '<option value="">暂无交易所</option>';
      if (index >= matrix.exchanges.length && matrix.exchanges.length) {
        options += '<option value="">暂无第二家交易所</option>';
      }
      select.innerHTML = options;
      select.disabled = index >= matrix.exchanges.length;
      select.value = selected[index] || '';
    });
    document.querySelector('#rank-table thead').innerHTML =
      '<tr><th>标的</th>' + visible.map(function (exchange) {
        return '<th class="matrix-venue">' + esc(APP.EX_NAMES[exchange] || exchange) +
          '</th>';
      }).join('') + '<th class="num matrix-aux">覆盖</th>' +
      '<th class="num matrix-aux">合计</th></tr>';
    document.querySelector('#rank-table tbody').innerHTML = rows.map(function (row) {
      return '<tr><th scope="row" class="matrix-row-head"><span class="matrix-ticker">' +
        esc(row.ticker) + '</span><span class="matrix-type">' +
        esc(APP.TYPE_NAMES[row.asset_type] || row.asset_type) + '</span></th>' +
        visible.map(function (exchange) {
          var cell = row.cells[exchange];
          if (!cell) return '<td class="matrix-cell matrix-missing">—</td>';
          var tone = Math.min(4, Math.ceil(cell.rank / 5));
          var label = (APP.EX_NAMES[exchange] || exchange) + ' 第 ' + cell.rank +
            ' 名，' + (effective === 'oi' ? 'OI ' : '成交额 ') + fmtUsd(cell.value);
          return '<td class="matrix-cell rank-tone-' + tone + '" aria-label="' +
            esc(label) + '"><span class="matrix-rank">#' + cell.rank +
            '</span><span class="matrix-value">' + fmtUsd(cell.value) +
            '</span></td>';
        }).join('') + '<td class="num matrix-aux">' + row.coverage + '/' +
        visible.length + '</td><td class="num matrix-aux">' +
        fmtUsd(row.total) + '</td></tr>';
    }).join('');
    var tableWrap = document.getElementById('rank-table-wrap');
    var empty = document.getElementById('rank-empty');
    tableWrap.hidden = rows.length === 0;
    empty.hidden = rows.length !== 0;
    empty.textContent = matrix.exchanges.length === 0
      ? '所选日期暂无' + (effective === 'oi' ? ' OI ' : '成交额') + '排行数据'
      : '没有符合当前条件的标的';
    document.getElementById('rank-summary').textContent =
      rows.length + ' 个标的 · ' + visible.length + ' 家交易所';
    return { metric: effective, search: state.search || '',
      minCoverage: minCoverage, sort: sort, mobile: mobile,
      mobileExchanges: selected, availableExchanges: matrix.exchanges,
      visibleExchanges: visible };
  };

  APP.bestDepth = function (row, depthKey) {
    var vals = row.exchanges.map(function (e) { return e[depthKey]; })
      .filter(function (v) { return v !== null && v !== undefined; });
    return vals.length ? Math.max.apply(null, vals) : null;
  };

  // 含RPI 内联对比:`API → 含RPI(total)`;仅两侧都有值才对比,否则只显 API。
  // betterWhenLower=true(点差,越小越好,显 −收窄)/ false(深度,越大越好,显 +增量);
  // 改善量 ≤0(两次独立请求的时点偏移致反向/持平)不显,避免负号误导(F9)。
  APP.rpiCell = function (apiVal, totalVal, fmt, betterWhenLower) {
    if (apiVal === null || apiVal === undefined ||
        totalVal === null || totalVal === undefined) return fmt(apiVal);
    var html = fmt(apiVal) + ' <span class="rpi-arrow">→</span> ' +
               '<span class="rpi">' + fmt(totalVal) + '</span>';
    var improve = betterWhenLower ? (apiVal - totalVal) : (totalVal - apiVal);
    // 改善量在显示精度下不为 0 才显(避免 "0.07→0.07 (−0.00)" 这类噪声)
    if (improve > 0 && fmt(improve) !== fmt(0)) {
      html += ' <span class="rpi-delta">(' +
              (betterWhenLower ? '−' : '+') + fmt(improve) + ')</span>';
    }
    return html;
  };

  APP.renderTickerTable = function (st) {
    var live = st.detailMode === 'live';
    // 频率标签随视图联动(日快照=每日更新;最新时点=每 4 小时刷新)
    var freqTag = document.getElementById('ticker-freq-tag');
    if (freqTag) {
      freqTag.textContent = live ? '每 4 小时刷新' : '每日更新';
      freqTag.className = 'freq-tag ' + (live ? 'h4' : 'daily');
    }
    function arrow(key) {
      return st.sortKey === key ? (st.sortDesc ? ' ▾' : ' ▴') : '';
    }
    var depthTitle = live
      ? '最新时点视图:最近一次 4 小时快照的单时点值'
      : '日快照视图:当日各 4 小时时点的中位数(2026-07-14 前的历史日为单时点值)';
    var fundingTitle = (live
      ? '最新时点视图:当期预告费率折 8 小时'
      : '日快照视图:当日已结算费率合计÷3(=日累计折 8h 等效)') +
      ';主行=各所中位数;正=多头付费给空头';
    var thead = document.querySelector('#ticker-table thead');
    thead.innerHTML = '<tr><th></th>' +
      '<th data-sort="ticker">标的' + arrow('ticker') + '</th>' +
      '<th data-sort="asset_type">类型' + arrow('asset_type') + '</th>' +
      '<th class="num" data-sort="vol">' +
      (live ? '24h 成交(滚动)' : '日成交') + arrow('vol') + '</th>' +
      (st.hasOi ? '<th class="num" data-sort="oi">持仓 OI' + arrow('oi') + '</th>' : '') +
      '<th class="num" data-sort="n_exchanges">上架源数' + arrow('n_exchanges') + '</th>' +
      '<th class="num" data-sort="best_spread_bps" title="' + depthTitle + '">最优点差' + arrow('best_spread_bps') + '</th>' +
      '<th class="num" data-sort="_best_depth" title="' + depthTitle + '">最优深度' + APP.DEPTH_LABELS[st.depthKey] +
      arrow('_best_depth') + '</th>' +
      (st.hasOi ? '<th class="num" data-sort="funding_8h" title="' + fundingTitle + '">Funding(折8h)' +
      arrow('funding_8h') + '</th>' : '') + '</tr>';

    var tbody = document.querySelector('#ticker-table tbody');
    var pager = document.getElementById('ticker-pagination');
    var pagerSummary = document.getElementById('ticker-pagination-summary');
    var pagerList = document.getElementById('ticker-pagination-list');
    function hidePager() {
      pager.hidden = true;
      pagerSummary.textContent = '';
      pagerList.innerHTML = '';
      st.detailTotalPages = 1;
    }
    function renderPager(pageInfo) {
      st.detailPage = pageInfo.page;
      st.detailTotalPages = pageInfo.totalPages;
      if (pageInfo.totalPages <= 1) { hidePager(); return; }
      var items = APP.pageItems(pageInfo.page, pageInfo.totalPages);
      function button(page, label, text, disabled, current) {
        return '<li><button type="button" data-page="' + page + '"' +
          ' aria-label="' + label + '"' +
          (disabled ? ' disabled' : '') +
          (current ? ' class="active" aria-current="page"' : '') +
          '>' + text + '</button></li>';
      }
      var controls = button(pageInfo.page - 1, '上一页', '上一页',
                            pageInfo.page === 1, false);
      items.forEach(function (item) {
        if (item === '…') {
          controls += '<li class="pagination-ellipsis" aria-label="省略的页码">…</li>';
          return;
        }
        controls += button(item, '第 ' + item + ' 页', item, false,
                           item === pageInfo.page);
      });
      controls += button(pageInfo.page + 1, '下一页', '下一页',
                         pageInfo.page === pageInfo.totalPages, false);
      pagerSummary.textContent = '共 ' + pageInfo.total + ' 个标的 · 第 ' +
        pageInfo.page + '/' + pageInfo.totalPages + ' 页';
      pagerList.innerHTML = controls;
      pager.hidden = false;
    }
    var detail = st.currentDetail();
    if (detail === null) {   // 切片加载中,与"真无数据"区分
      hidePager();
      tbody.innerHTML = '<tr><td colspan="' + (st.hasOi ? 9 : 7) +
        '" class="na">加载中…</td></tr>';
      return;
    }
    var rows = detail.filter(function (r) {
      if (st.typeFilter !== 'all' && r.asset_type !== st.typeFilter) return false;
      if (st.searchTerm && r.ticker.indexOf(st.searchTerm.toUpperCase()) === -1) return false;
      return true;
    }).slice().sort(function (a, b) {
      var av = st.sortKey === '_best_depth' ? APP.bestDepth(a, st.depthKey) : a[st.sortKey];
      var bv = st.sortKey === '_best_depth' ? APP.bestDepth(b, st.depthKey) : b[st.sortKey];
      var aNull = av === null || av === undefined;
      var bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === 'string') return st.sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      return st.sortDesc ? bv - av : av - bv;
    });
    var pageInfo = APP.paginate(rows, st.detailPage, st.detailPageSize);
    renderPager(pageInfo);
    var colspan = st.hasOi ? 9 : 7;
    tbody.innerHTML = pageInfo.rows.map(function (r, i) {
      var subs = r.exchanges.map(function (e) {
        var isChain = e.exchange === 'ondo';
        var hasRpi = e.spread_bps_total !== null && e.spread_bps_total !== undefined;
        var srcName = esc(APP.EX_NAMES[e.exchange] || e.exchange) +
          (isChain ? ' <span class="tag" title="链上成交,UTC 自然日口径(非 24h 滚动),无盘口数据">UTC 日</span>' : '') +
          (hasRpi ? ' <span class="tag" title="点差/深度含 RPI(零售改善单)合并盘口口径;仅 Binance 提供,不与其它所横比;total 顶档不含被交易所隐藏的交叉档">含RPI</span>' : '');
        var cells = '<tr class="sub" data-parent="' + i + '" hidden>' +
          '<td></td><td>' + srcName +
          ' <span class="na">' + esc(e.symbol) + '</span></td><td></td>' +
          '<td class="num">' + fmtUsd(e.vol) + '</td>';
        if (st.hasOi) cells += '<td class="num">' + fmtUsd(e.oi) + '</td>';
        return cells + '<td></td>' +
          '<td class="num">' + APP.rpiCell(e.spread_bps, e.spread_bps_total, fmtBps, true) + '</td>' +
          '<td class="num">' + APP.rpiCell(e[st.depthKey], e[st.depthKey + '_total'], fmtUsd, false) + '</td>' +
          (st.hasOi ? '<td class="num">' + APP.fmtFunding(e.funding_8h) + '</td>' : '') +
          '</tr>';
      }).join('');
      var main = '<tr class="main" data-idx="' + i + '">' +
        '<td class="expander">▸</td>' +
        '<td><span class="ticker-link" data-ticker="' + esc(r.ticker) +
        '" title="' + esc(((window.PERP_DATA || {}).ticker_notes || {})[r.ticker] || '') +
        '">' + esc(r.ticker) + '</span></td>' +
        '<td><span class="tag">' + esc(APP.TYPE_NAMES[r.asset_type] || r.asset_type) + '</span></td>' +
        '<td class="num">' + fmtUsd(r.vol) + '</td>';
      if (st.hasOi) main += '<td class="num">' + fmtUsd(r.oi) + '</td>';
      return main +
        '<td class="num">' + r.n_exchanges + '</td>' +
        '<td class="num">' + fmtBps(r.best_spread_bps) + '</td>' +
        '<td class="num">' + fmtUsd(APP.bestDepth(r, st.depthKey)) + '</td>' +
        (st.hasOi ? '<td class="num">' + APP.fmtFunding(r.funding_8h) + '</td>' : '') +
        '</tr>' + subs;
    }).join('') || ('<tr><td colspan="' + colspan + '" class="na">无数据</td></tr>');
  };

  APP.renderFooterMeta = function (st) {
    var meta = st.block().meta;
    var warnBox = document.getElementById('warnings');
    warnBox.innerHTML = '';
    (meta.warnings || []).forEach(function (w) {
      var p = document.createElement('p');
      p.className = 'warn-line';
      p.textContent = '⚠ ' + w;
      warnBox.appendChild(p);
    });
    document.getElementById('generated-at').textContent =
      meta.generated_at
        ? '数据生成时间:' + APP.beijingIso(meta.generated_at) + '(北京)' : '';
  };

  APP.renderModalChart = function (st, chart, ticker) {
    var series = (st.block().ticker_series || {})[ticker] || [];
    var hasPrice = series.some(function (x) {
      return x.price !== null && x.price !== undefined;
    });
    var opts = {
      backgroundColor: 'transparent', textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: fmtUsd }),
      legend: { data: [], textStyle: { color: '#8b949e' } },
      grid: { left: 70, right: hasPrice ? (st.hasOi ? 160 : 80) : 60,
              top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category',
        data: series.map(function (x) { return x.date; }) }, axisStyle()),
      yAxis: [Object.assign({ type: 'value' }, axisStyle(fmtUsd))],
      series: [{ name: '成交', type: 'bar',
        data: series.map(function (x) { return x.vol; }),
        itemStyle: { color: '#58a6ff' }, barMaxWidth: 20 }],
    };
    if (st.hasOi) {
      opts.yAxis.push(Object.assign({ type: 'value' }, axisStyle(fmtUsd),
                                     { splitLine: { show: false } }));
      opts.series.push({ name: 'OI', type: 'line', yAxisIndex: 1, smooth: true,
        data: series.map(function (x) { return x.oi; }),
        itemStyle: { color: '#d29922' } });
    }
    if (hasPrice) {
      var priceAxisIndex = opts.yAxis.length;
      opts.yAxis.push(Object.assign(
        { type: 'value', position: 'right', offset: st.hasOi ? 72 : 0 },
        axisStyle(fmtPrice), { splitLine: { show: false } }));
      opts.series.push({ name: '价格', type: 'line',
        yAxisIndex: priceAxisIndex, smooth: true,
        data: series.map(function (x) { return x.price; }),
        itemStyle: { color: '#3fb950' }, lineStyle: { width: 2 },
        tooltip: { valueFormatter: fmtPrice } });
    }
    opts.legend.data = opts.series.map(function (s) { return s.name; });
    chart.setOption(opts, true);
  };

  // 弹窗费率日线(funding-stats F5):每所一条,断点如实(勿 connectNulls);
  // 数据为已结算日累计折 8h(与明细日快照视图同口径);perp 专属。
  // 返回是否有数据(调用方据此显隐面板)
  APP.renderModalFunding = function (st, chart, ticker) {
    var block = st.block();
    var dates = block.funding_dates || [];
    var byEx = (block.funding_daily || {})[ticker];
    if (!dates.length || !byEx) return false;
    var exs = Object.keys(byEx).sort();
    var fmtPct = APP.fmtFundingPct;
    chart.setOption({
      backgroundColor: 'transparent', textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: fmtPct }),
      legend: { data: exs.map(function (ex) { return APP.EX_NAMES[ex] || ex; }),
                textStyle: { color: '#8b949e' } },
      grid: { left: 70, right: 24, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: dates }, axisStyle()),
      yAxis: [Object.assign({ type: 'value' }, axisStyle(fmtPct))],
      series: exs.map(function (ex, i) {
        return { name: APP.EX_NAMES[ex] || ex, type: 'line',
                 itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
                 data: byEx[ex], symbolSize: 3 };
      }),
    }, true);
    return true;
  };
})();

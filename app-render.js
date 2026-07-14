/* 渲染层:所有渲染函数按当前数据块(perp/spot)参数化;状态由 app-main.js 持有 */
(function () {
  'use strict';
  var APP = window.APP;
  var esc = APP.esc, fmtUsd = APP.fmtUsd, fmtDelta = APP.fmtDelta,
      fmtBps = APP.fmtBps;

  function axisStyle() {
    return { axisLine: { lineStyle: { color: '#2d333b' } },
             splitLine: { lineStyle: { color: '#21262d' } },
             axisLabel: { color: '#8b949e' } };
  }
  var dark = { backgroundColor: 'transparent',
    textStyle: { color: '#8b949e' },
    tooltip: { trigger: 'axis', backgroundColor: '#161b22',
               borderColor: '#2d333b', textStyle: { color: '#e6edf3' } } };
  APP.axisStyle = axisStyle;
  APP.darkTheme = dark;

  APP.renderHeader = function (st) {
    var meta = st.block().meta;
    document.getElementById('meta-line').textContent =
      meta.latest_date ? '最新快照日(UTC):' + meta.latest_date
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
    var rows = APP.aggregate(st.block().overview_series, st.granularity,
                             st.block().meta.latest_date);
    var series = [{ name: '成交', type: 'bar',
      data: rows.map(function (r) { return r.vol; }),
      itemStyle: { color: '#58a6ff' }, barMaxWidth: 26 }];
    var yAxes = [Object.assign({ type: 'value', name: '成交',
      axisLabel: { color: '#8b949e', formatter: fmtUsd } }, axisStyle())];
    if (st.hasOi) {
      yAxes.push(Object.assign({ type: 'value', name: 'OI',
        splitLine: { show: false },
        axisLabel: { color: '#8b949e', formatter: fmtUsd } }, axisStyle()));
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
    var es = st.block().exchange_series;
    var names = Object.keys(es);
    var rows = APP.aggregate(st.block().overview_series, st.granularity,
                             st.block().meta.latest_date);
    var labels = rows.map(function (r) { return r.label; });
    var series = names.map(function (ex, i) {
      var agg = APP.aggregate(es[ex], st.granularity, st.block().meta.latest_date);
      var byLabel = {};
      agg.forEach(function (r) { byLabel[r.label] = r.vol; });
      return { name: APP.EX_NAMES[ex] || ex, type: 'line', stack: 'vol',
               areaStyle: { opacity: .35 }, smooth: true, symbol: 'none',
               itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
               data: labels.map(function (l) { return byLabel[l] || 0; }) };
    });
    chart.setOption({
      backgroundColor: dark.backgroundColor, textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: fmtUsd }),
      legend: { textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 20, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: labels }, axisStyle()),
      yAxis: Object.assign({ type: 'value',
        axisLabel: { color: '#8b949e', formatter: fmtUsd } }, axisStyle()),
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
      '<th class="num">标的数</th></tr>';
    var tbody = document.querySelector('#exchange-table tbody');
    var target = st.selectedDate || latest;
    var rows = Object.keys(es).map(function (ex) {
      var s = es[ex];
      var i = -1;
      for (var k = s.length - 1; k >= 0; k--) {
        if (s[k].date <= target) { i = k; break; }
      }
      var cur = i >= 0 ? s[i] : {};
      var prv = i > 0 ? s[i - 1] : {};
      var stale = cur.date !== target;
      return { ex: ex, cur: cur, prv: prv, stale: stale };
    }).sort(function (a, b) { return (b.cur.vol || 0) - (a.cur.vol || 0); });
    tbody.innerHTML = rows.map(function (r) {
      var name = esc(APP.EX_NAMES[r.ex] || r.ex) +
        (r.stale ? ' <span class="tag" title="当日拉取失败,显示最近成功日数据">数据: ' +
                   esc(r.cur.date) + '</span>' : '');
      var cells = '<tr class="main"><td>' + name + '</td>' +
        '<td class="num">' + fmtUsd(r.cur.vol) + '</td>' +
        '<td class="num">' + (r.stale ? '—' : fmtDelta(r.cur.vol, r.prv.vol)) + '</td>';
      if (st.hasOi) {
        cells += '<td class="num">' + fmtUsd(r.cur.oi) + '</td>' +
          '<td class="num">' + (r.stale ? '—' : fmtDelta(r.cur.oi, r.prv.oi)) + '</td>';
      }
      return cells + '<td class="num">' + (r.cur.count || 0) + '</td></tr>';
    }).join('');
  };

  APP.bestDepth = function (row, depthKey) {
    var vals = row.exchanges.map(function (e) { return e[depthKey]; })
      .filter(function (v) { return v !== null && v !== undefined; });
    return vals.length ? Math.max.apply(null, vals) : null;
  };

  APP.renderTickerTable = function (st) {
    function arrow(key) {
      return st.sortKey === key ? (st.sortDesc ? ' ▾' : ' ▴') : '';
    }
    var thead = document.querySelector('#ticker-table thead');
    thead.innerHTML = '<tr><th></th>' +
      '<th data-sort="ticker">标的' + arrow('ticker') + '</th>' +
      '<th data-sort="asset_type">类型' + arrow('asset_type') + '</th>' +
      '<th class="num" data-sort="vol">日成交' + arrow('vol') + '</th>' +
      (st.hasOi ? '<th class="num" data-sort="oi">持仓 OI' + arrow('oi') + '</th>' : '') +
      '<th class="num" data-sort="n_exchanges">上架源数' + arrow('n_exchanges') + '</th>' +
      '<th class="num" data-sort="best_spread_bps">最优点差' + arrow('best_spread_bps') + '</th>' +
      '<th class="num" data-sort="_best_depth">最优深度' + APP.DEPTH_LABELS[st.depthKey] +
      arrow('_best_depth') + '</th></tr>';

    var tbody = document.querySelector('#ticker-table tbody');
    var rows = st.currentDetail().filter(function (r) {
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
    var colspan = st.hasOi ? 8 : 7;
    tbody.innerHTML = rows.map(function (r, i) {
      var subs = r.exchanges.map(function (e) {
        var isChain = e.exchange === 'ondo';
        var srcName = esc(APP.EX_NAMES[e.exchange] || e.exchange) +
          (isChain ? ' <span class="tag" title="链上成交,UTC 自然日口径(非 24h 滚动),无盘口数据">UTC 日</span>' : '');
        var cells = '<tr class="sub" data-parent="' + i + '" hidden>' +
          '<td></td><td>' + srcName +
          ' <span class="na">' + esc(e.symbol) + '</span></td><td></td>' +
          '<td class="num">' + fmtUsd(e.vol) + '</td>';
        if (st.hasOi) cells += '<td class="num">' + fmtUsd(e.oi) + '</td>';
        return cells + '<td></td>' +
          '<td class="num">' + fmtBps(e.spread_bps) + '</td>' +
          '<td class="num">' + fmtUsd(e[st.depthKey]) + '</td></tr>';
      }).join('');
      var main = '<tr class="main" data-idx="' + i + '">' +
        '<td class="expander">▸</td>' +
        '<td><span class="ticker-link" data-ticker="' + esc(r.ticker) + '">' + esc(r.ticker) + '</span></td>' +
        '<td><span class="tag">' + esc(APP.TYPE_NAMES[r.asset_type] || r.asset_type) + '</span></td>' +
        '<td class="num">' + fmtUsd(r.vol) + '</td>';
      if (st.hasOi) main += '<td class="num">' + fmtUsd(r.oi) + '</td>';
      return main +
        '<td class="num">' + r.n_exchanges + '</td>' +
        '<td class="num">' + fmtBps(r.best_spread_bps) + '</td>' +
        '<td class="num">' + fmtUsd(APP.bestDepth(r, st.depthKey)) + '</td></tr>' + subs;
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
      meta.generated_at ? '数据生成时间:' + meta.generated_at : '';
  };

  APP.renderModalChart = function (st, chart, ticker) {
    var series = (st.block().ticker_series || {})[ticker] || [];
    var opts = {
      backgroundColor: 'transparent', textStyle: dark.textStyle,
      tooltip: Object.assign({}, dark.tooltip, { valueFormatter: fmtUsd }),
      legend: { data: st.hasOi ? ['成交', 'OI'] : ['成交'],
                textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 60, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category',
        data: series.map(function (x) { return x.date; }) }, axisStyle()),
      yAxis: [Object.assign({ type: 'value',
        axisLabel: { color: '#8b949e', formatter: fmtUsd } }, axisStyle())],
      series: [{ name: '成交', type: 'bar',
        data: series.map(function (x) { return x.vol; }),
        itemStyle: { color: '#58a6ff' }, barMaxWidth: 20 }],
    };
    if (st.hasOi) {
      opts.yAxis.push(Object.assign({ type: 'value', splitLine: { show: false },
        axisLabel: { color: '#8b949e', formatter: fmtUsd } }, axisStyle()));
      opts.series.push({ name: 'OI', type: 'line', yAxisIndex: 1, smooth: true,
        data: series.map(function (x) { return x.oi; }),
        itemStyle: { color: '#d29922' } });
    }
    chart.setOption(opts, true);
  };
})();

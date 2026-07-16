/* v4 日内层:时粒度双图 + 日内演化面板 + 弹窗小时柱(数据源 data.js intraday 块与 day 切片) */
(function () {
  'use strict';
  var APP = window.APP;
  var fmtUsd = APP.fmtUsd, fmtBps = APP.fmtBps;

  function shortTs(ts) {   // '2026-07-15T08:00' → '07-15 08:00'
    return ts.slice(5, 10) + ' ' + ts.slice(11);
  }

  function market(st) {
    var block = st.intraday();
    return (st.mode === 'spot' ? block.spot : block.perp) ||
           { spread_by_exchange: {}, vol_total: [], vol_by_exchange: {} };
  }

  // ---- 粒度"时":总量图(近 7 天 1h 成交;OI 为 4h 粒度,归日内面板)----
  APP.renderHourlyTotal = function (st, chart) {
    var m = market(st), hours = st.intraday().meta.hour_ts || [];
    chart.setOption({
      backgroundColor: APP.darkTheme.backgroundColor,
      textStyle: APP.darkTheme.textStyle,
      tooltip: Object.assign({}, APP.darkTheme.tooltip,
                             { valueFormatter: fmtUsd }),
      legend: { data: ['小时成交'], textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 60, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: hours.map(shortTs) },
                           APP.axisStyle()),
      yAxis: [Object.assign({ type: 'value' }, APP.axisStyle(fmtUsd))],
      series: [{ name: '小时成交', type: 'bar', data: m.vol_total,
                 itemStyle: { color: '#58a6ff' }, barMaxWidth: 8 }],
    }, true);
  };

  APP.renderHourlyShare = function (st, chart) {
    var m = market(st), hours = st.intraday().meta.hour_ts || [];
    var names = Object.keys(m.vol_by_exchange || {});
    chart.setOption({
      backgroundColor: APP.darkTheme.backgroundColor,
      textStyle: APP.darkTheme.textStyle,
      tooltip: Object.assign({}, APP.darkTheme.tooltip,
                             { valueFormatter: fmtUsd }),
      legend: { textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 20, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: hours.map(shortTs) },
                           APP.axisStyle()),
      yAxis: Object.assign({ type: 'value' }, APP.axisStyle(fmtUsd)),
      series: names.map(function (ex, i) {
        var stacked = st.shareStack !== 'line';
        return { name: APP.EX_NAMES[ex] || ex, type: 'line',
                 stack: stacked ? 'vol' : undefined,
                 areaStyle: stacked ? { opacity: .35 } : undefined,
                 symbol: 'none',
                 itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
                 data: (m.vol_by_exchange[ex] || []).map(function (v) {
                   // 补 0 是堆叠的技术需要;独立模式缺时 null 自然断线
                   return stacked ? (v === null ? 0 : v) : v;
                 }) };
      }),
    }, true);
  };

  // ---- 日内演化面板(近 7 天 4h 时点;缺网格点自然断线,不可回填)----
  APP.renderIntradayPanel = function (st, oiChart, spreadChart) {
    var block = st.intraday(), grid = block.meta.grid_ts || [];
    var labels = grid.map(shortTs);
    var oiBox = document.getElementById('intraday-oi-box');
    if (st.hasOi) {
      var wasHidden = oiBox.hidden;
      oiBox.hidden = false;
      // 隐藏期间窗口 resize 会让画布记住 fallback 尺寸(实测卡 100px 宽),
      // unhide 后必须补一次 resize(与弹窗小时图同式)
      if (wasHidden) {
        setTimeout(function () { oiChart.resize(); }, 0);
      }
      oiChart.setOption({
        backgroundColor: APP.darkTheme.backgroundColor,
        textStyle: APP.darkTheme.textStyle,
        tooltip: Object.assign({}, APP.darkTheme.tooltip,
                               { valueFormatter: fmtUsd }),
        legend: { data: ['OI 总量'], textStyle: { color: '#8b949e' } },
        grid: { left: 60, right: 20, top: 34, bottom: 40 },
        xAxis: Object.assign({ type: 'category', data: labels },
                             APP.axisStyle()),
        yAxis: Object.assign({ type: 'value' }, APP.axisStyle(fmtUsd)),
        series: [{ name: 'OI 总量', type: 'line', connectNulls: false,
                   data: (block.perp || {}).oi_total || [],
                   itemStyle: { color: '#d29922' }, lineStyle: { width: 2 } }],
      }, true);
    } else {
      oiBox.hidden = true;
    }
    var sp = market(st).spread_by_exchange || {};
    var names = Object.keys(sp);
    spreadChart.setOption({
      backgroundColor: APP.darkTheme.backgroundColor,
      textStyle: APP.darkTheme.textStyle,
      tooltip: Object.assign({}, APP.darkTheme.tooltip, {
        valueFormatter: function (v) { return fmtBps(v); } }),
      legend: { textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 20, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: labels },
                           APP.axisStyle()),
      yAxis: Object.assign({ type: 'value' }, APP.axisStyle(
        function (v) { return v + 'bp'; })),
      series: names.map(function (ex, i) {
        return { name: APP.EX_NAMES[ex] || ex, type: 'line',
                 connectNulls: false, symbolSize: 4,
                 itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
                 data: sp[ex] };
      }),
    }, true);
  };

  // ---- TradFi 占比趋势(固定全窗,随 perp/spot tab)----
  APP.renderTradfiChart = function (st, chart) {
    var ts = st.block().tradfi_share || { dates: [], by_exchange: {} };
    var names = Object.keys(ts.by_exchange);
    var series = names.map(function (ex, i) {
      return { name: APP.EX_NAMES[ex] || ex, type: 'line',
               connectNulls: false, symbolSize: 4,
               itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
               data: ts.by_exchange[ex] };
    });
    if (ts.total && ts.total.length) {
      series.unshift({ name: '全市场', type: 'line', connectNulls: false,
                       symbolSize: 5, lineStyle: { width: 3 },
                       itemStyle: { color: '#e6edf3' },
                       data: ts.total });
    }
    chart.setOption({
      backgroundColor: APP.darkTheme.backgroundColor,
      textStyle: APP.darkTheme.textStyle,
      tooltip: Object.assign({}, APP.darkTheme.tooltip, {
        valueFormatter: function (v) {
          return (v === null || v === undefined) ? '—' : v + '%';
        } }),
      legend: { textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 20, top: 34, bottom: 40 },
      xAxis: Object.assign({ type: 'category', data: ts.dates },
                           APP.axisStyle()),
      yAxis: Object.assign({ type: 'value' }, APP.axisStyle(
        function (v) { return v + '%'; })),
      series: series,
    }, true);
  };

  // ---- 近 7 天上新(双市场合并,静态,不随 tab)----
  // 按 (ticker, market) 聚合:同票多所合并一行,交易所列并列展示
  // (各所首见日不同时以 title 提示);超过 12 行默认收起
  var LISTINGS_COLLAPSE_AT = 12;
  APP.renderListings = function (expanded) {
    var nl = (window.PERP_DATA || {}).new_listings || { items: [] };
    var esc = APP.esc;
    var tbody = document.querySelector('#listings-table tbody');
    if (!tbody) return;
    var groups = {};
    var order = [];
    nl.items.forEach(function (it) {
      var key = it.ticker + '|' + it.market;
      if (!groups[key]) {
        groups[key] = { ticker: it.ticker, market: it.market,
                        asset_type: it.asset_type,
                        is_new_global: it.is_new_global,
                        first_seen: it.first_seen, exchanges: [] };
        order.push(key);
      }
      var g = groups[key];
      if (it.first_seen < g.first_seen) g.first_seen = it.first_seen;
      g.exchanges.push({ exchange: it.exchange, date: it.first_seen });
    });
    var rows = order.map(function (k) { return groups[k]; });
    rows.sort(function (a, b) {
      return a.first_seen === b.first_seen
        ? (a.ticker < b.ticker ? -1 : 1)
        : (a.first_seen < b.first_seen ? 1 : -1);
    });
    var shown = expanded ? rows : rows.slice(0, LISTINGS_COLLAPSE_AT);
    var notes = (window.PERP_DATA || {}).ticker_notes || {};
    var html = shown.map(function (g) {
      var exCell = g.exchanges.map(function (e) {
        var name = esc(APP.EX_NAMES[e.exchange] || e.exchange);
        return e.date === g.first_seen
          ? name
          : '<span title="该所上架日 ' + esc(e.date) + '">' + name + '</span>';
      }).join('、');
      return '<tr><td>' + esc(g.first_seen) + '</td>' +
        '<td><b>' + esc(g.ticker) + '</b>' +
        (g.is_new_global
          ? ' <span class="tag" title="全市场首见新票">★ 新票</span>' : '') +
        '</td>' +
        '<td class="note">' + esc(notes[g.ticker] || '—') + '</td>' +
        '<td><span class="tag">' +
        esc(APP.TYPE_NAMES[g.asset_type] || g.asset_type) + '</span></td>' +
        '<td>' + (g.market === 'spot' ? '现货' : 'Perp') + '</td>' +
        '<td>' + exCell + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="na">近 7 天无上新</td></tr>';
    if (!expanded && rows.length > LISTINGS_COLLAPSE_AT) {
      html += '<tr><td colspan="6" class="na" style="cursor:pointer" ' +
        'id="listings-more">展开全部 ' + rows.length + ' 项 ▾</td></tr>';
    }
    tbody.innerHTML = html;
    var more = document.getElementById('listings-more');
    if (more) {
      more.addEventListener('click', function () {
        APP.renderListings(true);
      });
    }
  };

  // ---- 弹窗:该日 24 根小时成交柱 + 4h OI 折线(切片无数据则隐藏)----
  APP.renderModalHour = function (st, chart, ticker, slice) {
    var box = document.getElementById('modal-hour-box');
    var mk = st.mode === 'spot' ? 'spot' : 'perp';
    var hourly = ((slice || {}).hourly || {})[mk] || {};
    var intra = ((slice || {}).intraday || {})[mk] || {};
    var vols = hourly[ticker];
    var pts = intra[ticker];
    if (!vols && !pts) { box.hidden = true; return false; }
    box.hidden = false;
    var hours = [];
    for (var h = 0; h < 24; h++) {
      hours.push((h < 10 ? '0' + h : h) + ':00');
    }
    var oiLine = null;
    if (st.hasOi && pts) {
      oiLine = hours.map(function () { return null; });
      pts.forEach(function (p) {
        if (p.ts.slice(0, 10) !== slice.date) return;  // 异日点防错标 24h
        var idx = parseInt(p.ts.slice(11, 13), 10);
        oiLine[idx] = p.oi;
      });
    }
    var series = [{ name: '小时成交', type: 'bar', data: vols || [],
                    itemStyle: { color: '#58a6ff' }, barMaxWidth: 14 }];
    var yAxes = [Object.assign({ type: 'value' }, APP.axisStyle(fmtUsd))];
    if (oiLine && oiLine.some(function (v) { return v !== null; })) {
      yAxes.push(Object.assign({ type: 'value' }, APP.axisStyle(fmtUsd),
                               { splitLine: { show: false } }));
      series.push({ name: 'OI(4h 时点)', type: 'line', yAxisIndex: 1,
                    connectNulls: true, showSymbol: true, symbolSize: 6,
                    data: oiLine, itemStyle: { color: '#d29922' } });
    }
    document.getElementById('modal-hour-title').textContent =
      '该日小时成交(' + (slice.date || '') + ' UTC)';
    chart.setOption({
      backgroundColor: APP.darkTheme.backgroundColor,
      textStyle: APP.darkTheme.textStyle,
      tooltip: Object.assign({}, APP.darkTheme.tooltip,
                             { valueFormatter: fmtUsd }),
      legend: { data: series.map(function (s) { return s.name; }),
                textStyle: { color: '#8b949e' } },
      grid: { left: 60, right: 60, top: 34, bottom: 30 },
      xAxis: Object.assign({ type: 'category', data: hours },
                           APP.axisStyle()),
      yAxis: yAxes, series: series,
    }, true);
    return true;
  };
})();

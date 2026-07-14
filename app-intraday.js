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
        return { name: APP.EX_NAMES[ex] || ex, type: 'line', stack: 'vol',
                 areaStyle: { opacity: .35 }, symbol: 'none',
                 itemStyle: { color: APP.CHART_COLORS[i % APP.CHART_COLORS.length] },
                 data: (m.vol_by_exchange[ex] || []).map(function (v) {
                   return v === null ? 0 : v;   // 堆叠图缺时按 0(总量图保留断点)
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
      oiBox.hidden = false;
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

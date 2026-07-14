/* 公共工具:转义/格式化/周月聚合(供 app-render.js / app-main.js 使用;
   非 ES modules——file:// 直开有 CORS 限制,用全局命名空间 APP) */
(function () {
  'use strict';
  var APP = window.APP = {};

  APP.EX_NAMES = { binance: 'Binance', bybit: 'Bybit', aster: 'Aster',
                   kraken: 'Kraken', hyperliquid: 'Hyperliquid',
                   okx: 'OKX', bitget: 'Bitget', ondo: 'Ondo(链上)' };
  APP.TYPE_NAMES = { stock: '股票', etf: 'ETF', index: '指数',
                     preipo: 'Pre-IPO', commodity: '商品', other: '其他' };
  APP.CHART_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149',
                      '#bc8cff', '#39c5cf', '#ff9bce', '#9ece6a'];
  APP.DEPTH_LABELS = { depth5bps_usd: '±5bp', depth10bps_usd: '±10bp',
                       depth1pct_usd: '±1%', depth2pct_usd: '±2%',
                       depth_l3_usd: '前3档', depth_l25_usd: '前25档' };

  APP.beijingTs = function (ts) {
    // 'YYYY-MM-DDTHH:00'(UTC)→ 'YYYY-MM-DD HH:00'(UTC+8,北京无夏令时)
    var ms = Date.UTC(+ts.slice(0, 4), +ts.slice(5, 7) - 1,
                      +ts.slice(8, 10), +ts.slice(11, 13)) + 8 * 3600 * 1000;
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' +
           p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':00';
  };

  APP.esc = function (s) {  // 数据来自交易所 API,innerHTML 拼接前必须转义
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  APP.fmtUsd = function (v) {
    if (v === null || v === undefined) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  };

  APP.fmtDelta = function (cur, prev, flagged) {
    if (prev === null || prev === undefined || !prev
        || cur === null || cur === undefined) return '';
    var pct = (cur - prev) / prev * 100;
    var cls = pct >= 0 ? 'up' : 'down';
    var arrow = pct >= 0 ? '▲' : '▼';
    var flag = flagged ? ' <span class="flag" title="前后两日数据源覆盖面不同,环比含口径变化">⚑</span>' : '';
    return '<span class="delta ' + cls + '">' + arrow + ' ' +
           Math.abs(pct).toFixed(1) + '%' + flag + '</span>';
  };

  APP.fmtBps = function (v) {
    return v === null || v === undefined ? '—' : v.toFixed(1) + ' bp';
  };

  // ---- 周/月聚合(vol=求和,oi=均值;ISO 周,周四定年) ----
  function isoWeekKey(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var fday = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
    var week = 1 + Math.round((d - firstThu) / 604800000);
    return d.getUTCFullYear() + '-W' + (week < 10 ? '0' : '') + week;
  }
  function periodEnd(key, g) {
    if (g === 'month') {
      var y = +key.slice(0, 4), m = +key.slice(5, 7);
      return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    var parts = key.split('-W'), yy = +parts[0], w = +parts[1];
    var jan4 = new Date(Date.UTC(yy, 0, 4));
    var mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
    mon.setUTCDate(mon.getUTCDate() + 6);
    return mon.toISOString().slice(0, 10);
  }
  APP.aggregate = function (series, g, latestDate) {
    if (g === 'day') return series.map(function (x) {
      return { label: x.date, vol: x.vol, oi: x.oi, ongoing: false };
    });
    var keyFn = g === 'week' ? isoWeekKey
                             : function (d) { return d.slice(0, 7); };
    var groups = {}, order = [];
    series.forEach(function (x) {
      var k = keyFn(x.date);
      if (!groups[k]) { groups[k] = { vol: 0, ois: [] }; order.push(k); }
      groups[k].vol += x.vol || 0;
      if (x.oi !== null && x.oi !== undefined) groups[k].ois.push(x.oi);
    });
    return order.map(function (k) {
      var gp = groups[k];
      var oi = gp.ois.length
        ? gp.ois.reduce(function (a, b) { return a + b; }, 0) / gp.ois.length : null;
      var ongoing = periodEnd(k, g) > (latestDate || '');
      return { label: k + (ongoing ? '(进行中)' : ''), vol: gp.vol,
               oi: oi, ongoing: ongoing };
    });
  };
})();

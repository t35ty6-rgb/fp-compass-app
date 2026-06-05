// FP Compass — quiet premium charts (Chart.js 4.x)
// Renders 3 dashboard charts: status doughnut, age × AUM bar, upcoming 12M events stacked bar.
(function () {
  const NAVY = '#0A0A0A';
  const INDIGO = '#4F46E5';
  const INK_3 = '#6B6B6B';
  const HAIRLINE = '#ECECEA';
  const FONT = '"Manrope", "Noto Sans JP", -apple-system, "Hiragino Sans", sans-serif';

  // Indigo-centric palette with cool shades
  const PALETTE = ['#4F46E5', '#818CF8', '#C7CDF5', '#E5E7F8']; // important / active / new / dormant
  const AGE_COLOR = '#4F46E5';
  const EVENT_COLORS = {
    '教育':   '#4F46E5',
    '退職':   '#3730A3',
    '年金':   '#7C84E8',
    '住宅':   '#A5ADEF',
    '相続':   '#C7CDF5',
    '介護':   '#DEE2F8',
    'その他': '#EEF1FE',
  };

  let charts = {};

  function destroyAll() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  function setChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK_3;
    Chart.defaults.borderColor = HAIRLINE;
    Chart.defaults.plugins.legend.position = 'bottom';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'rect';
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.legend.labels.font = { family: FONT, size: 12, weight: '500' };
    Chart.defaults.plugins.tooltip.backgroundColor = NAVY;
    Chart.defaults.plugins.tooltip.titleColor = '#fff';
    Chart.defaults.plugins.tooltip.bodyColor = '#fff';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 4;
    Chart.defaults.plugins.tooltip.titleFont = { family: FONT, size: 12, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { family: FONT, size: 12 };
    Chart.defaults.plugins.tooltip.boxPadding = 6;
  }

  function statusBreakdown(clients) {
    const labels = ['重点', '管理中', '新規', '休眠'];
    const keys = ['important', 'active', 'new', 'dormant'];
    const counts = keys.map(k => clients.filter(c => c.status === k).length);
    return { labels, counts };
  }

  function ageBuckets(clients) {
    const buckets = ['20代', '30代', '40代', '50代', '60代', '70代+'];
    const totals = buckets.map(() => 0);
    clients.forEach(c => {
      const a = window.LifeEvents ? window.LifeEvents.currentAge(c) : 0;
      const idx = a < 30 ? 0 : a < 40 ? 1 : a < 50 ? 2 : a < 60 ? 3 : a < 70 ? 4 : 5;
      totals[idx] += (c.aum || 0);
    });
    return { labels: buckets, totals: totals.map(v => Math.round(v / 10000)) }; // 万円
  }

  // Classify event kind from event title text (heuristic, JP)
  function classifyKind(title) {
    if (!title) return 'その他';
    if (/教育|大学|高校|中学|小学|入学|進学|学資/.test(title)) return '教育';
    if (/退職|定年/.test(title)) return '退職';
    if (/年金/.test(title)) return '年金';
    if (/住宅|マイホーム|住ローン|ローン完済/.test(title)) return '住宅';
    if (/相続|遺産/.test(title)) return '相続';
    if (/介護|後期高齢/.test(title)) return '介護';
    return 'その他';
  }

  function upcoming12Months(clients) {
    const base = new Date('2026-05-27');
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), label: `${d.getMonth()+1}月` });
    }
    const kinds = Object.keys(EVENT_COLORS);
    const matrix = {};
    kinds.forEach(k => matrix[k] = months.map(() => 0));

    clients.forEach(c => {
      const evs = window.LifeEvents ? window.LifeEvents.generate(c) : [];
      evs.forEach(ev => {
        const ed = new Date(ev.date || ev.when || ev.d);
        if (isNaN(ed.getTime())) return;
        const idx = months.findIndex(m => m.y === ed.getFullYear() && m.m === ed.getMonth());
        if (idx >= 0) {
          const k = classifyKind(ev.title || ev.kind || ev.name || '');
          matrix[k][idx] += 1;
        }
      });
    });

    const datasets = kinds.map(k => ({
      label: k,
      data: matrix[k],
      backgroundColor: EVENT_COLORS[k],
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 2,
      barPercentage: 0.7,
      categoryPercentage: 0.85,
    })).filter(ds => ds.data.some(v => v > 0));

    return { labels: months.map(m => m.label), datasets };
  }

  function render() {
    if (!window.Chart || !window.DUMMY_CLIENTS) return;
    setChartDefaults();
    destroyAll();
    const clients = window.DUMMY_CLIENTS;

    // 1) Doughnut — status
    const statusEl = document.getElementById('chart-status');
    if (statusEl) {
      const sb = statusBreakdown(clients);
      charts.status = new Chart(statusEl, {
        type: 'doughnut',
        data: {
          labels: sb.labels,
          datasets: [{
            data: sb.counts,
            backgroundColor: PALETTE,
            borderColor: '#fff',
            borderWidth: 2,
            hoverOffset: 6,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                  const pct = total ? Math.round(ctx.parsed / total * 100) : 0;
                  return ` ${ctx.label} ${ctx.parsed}名 (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    // 2) Bar — age x AUM
    const aumEl = document.getElementById('chart-aum');
    if (aumEl) {
      const ab = ageBuckets(clients);
      charts.aum = new Chart(aumEl, {
        type: 'bar',
        data: {
          labels: ab.labels,
          datasets: [{
            label: 'AUM 合計 (万円)',
            data: ab.totals,
            backgroundColor: AGE_COLOR,
            borderRadius: 3,
            barPercentage: 0.62,
            categoryPercentage: 0.85,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.parsed.y.toLocaleString()} 万円`
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: FONT, size: 11 } } },
            y: {
              grid: { color: HAIRLINE, drawBorder: false },
              ticks: {
                font: { family: FONT, size: 11 },
                callback: (v) => v >= 10000 ? (v/10000).toFixed(1)+'億' : v.toLocaleString()
              }
            }
          }
        }
      });
    }

    // 3) Stacked bar — upcoming 12M
    const evEl = document.getElementById('chart-events');
    if (evEl) {
      const u = upcoming12Months(clients);
      charts.events = new Chart(evEl, {
        type: 'bar',
        data: {
          labels: u.labels,
          datasets: u.datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { font: { family: FONT, size: 11 } } },
            y: {
              stacked: true,
              grid: { color: HAIRLINE, drawBorder: false },
              ticks: { font: { family: FONT, size: 11 }, stepSize: 1, precision: 0 }
            }
          }
        }
      });
    }
  }

  // -----------------------------------------------------------
  // KPI sparklines — tiny line charts under each KPI
  // -----------------------------------------------------------
  let sparkCharts = {};
  function destroySparks() {
    Object.values(sparkCharts).forEach(c => { try { c.destroy(); } catch(e){} });
    sparkCharts = {};
  }
  function rnd(seed) { let x = Math.sin(seed) * 10000; return x - Math.floor(x); }
  function seededTrend(seed, len, base, vol, dir) {
    // dir: +1 up, -1 down, 0 flat
    const arr = [];
    let v = base;
    for (let i = 0; i < len; i++) {
      const noise = (rnd(seed + i) - 0.5) * vol;
      const drift = dir * (i / len) * vol * 0.6;
      v = Math.max(0, base + drift + noise);
      arr.push(Number(v.toFixed(2)));
    }
    return arr;
  }
  const SPARK_PRESETS = {
    clients: { seed: 11, base: 28,    vol: 1.5, dir: +1, color: INDIGO },
    events:  { seed: 23, base: 2.5,   vol: 1.2, dir: 0,  color: INDIGO },
    stale:   { seed: 41, base: 3,     vol: 1.0, dir: -1, color: INDIGO },
    aum:     { seed: 57, base: 6.5,   vol: 0.18, dir: +1, color: INDIGO },
  };
  function renderSparklines() {
    if (!window.Chart) return;
    destroySparks();
    document.querySelectorAll('canvas.kpi-spark').forEach(el => {
      const kind = el.dataset.spark;
      const preset = SPARK_PRESETS[kind] || SPARK_PRESETS.clients;
      const data = seededTrend(preset.seed, 14, preset.base, preset.vol, preset.dir);
      sparkCharts[kind] = new Chart(el, {
        type: 'line',
        data: {
          labels: data.map((_, i) => i),
          datasets: [{
            data: data,
            borderColor: preset.color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: {
              target: 'origin',
              above: 'rgba(91,91,240,0.08)',
            },
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: false }
          },
          elements: { line: { cubicInterpolationMode: 'monotone' } },
          animation: { duration: 400 }
        }
      });
    });
  }

  // Public
  window.FPCharts = { render: render, renderSparklines: renderSparklines };

  // Auto-render: wait for dummy data + Chart.js + LifeEvents
  function tryRender(attempt) {
    attempt = attempt || 0;
    if (window.Chart && window.DUMMY_CLIENTS && window.LifeEvents && document.getElementById('chart-status')) {
      render();
    } else if (attempt < 30) {
      setTimeout(() => tryRender(attempt + 1), 100);
    }
  }
  document.addEventListener('DOMContentLoaded', () => tryRender());

  // Re-render when dashboard tab becomes active again
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.tab[data-tab="dashboard"]');
    if (t) setTimeout(() => render(), 80);
  });
})();

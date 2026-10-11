/* AGENT//EVALS front-end. Renders site/data/leaderboard.json. No build step. */
(function () {
  "use strict";

  var DATA_URL = "data/leaderboard.json";
  var GREEN = "#35e08a", AMBER = "#ffb224", BLUE = "#5eb2ff",
      INK = "#e9f0f5", MUTED = "#8b98a8", HAIR = "#1d2733";

  var metric = "latency"; // or "cost"
  var chart = null;
  var leaderboard = null;

  function fmtPct(x) { return x == null ? "–" : (x * 100).toFixed(1) + "%"; }
  function fmtLat(s) { return s == null ? "–" : s.toFixed(1) + "s"; }
  function fmtCost(c) { return c == null ? "–" : "$" + c.toFixed(2); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function badge(kind) {
    return '<span class="badge ' + kind + '">' + kind + "</span>";
  }
  function archLabel(a) {
    return {"single-agent":"Single agent","mixture-of-agents":"Mixture-of-Agents",
            "refine":"Refine","graph-of-agents":"Graph-of-Agents"}[a] || a;
  }

  function xVal(r) {
    return metric === "latency" ? r.mean_latency_s : r.cost_usd;
  }
  function xLabel() { return metric === "latency" ? "mean latency / question (s)" : "total cost / run (USD)"; }

  /* ---------- KPIs ---------- */
  function renderKPIs(rows) {
    var measured = rows.filter(function (r) { return r.kind === "measured"; });
    var paper = rows.filter(function (r) { return r.kind === "paper"; });
    var best = measured.reduce(function (m, r) {
      return r.accuracy > m ? r.accuracy : m; }, 0);
    var sota = paper.filter(function (r) { return r.architecture === "graph-of-agents"; })[0];
    var maxN = rows.reduce(function (m, r) { return Math.max(m, r.n || 0); }, 0);
    document.getElementById("kpi-arch").textContent = measured.length + paper.length;
    document.getElementById("kpi-q").textContent = maxN || "–";
    var bestEl = document.getElementById("kpi-best");
    bestEl.textContent = measured.length ? fmtPct(best) : "pending";
    bestEl.classList.toggle("accent", measured.length > 0);
    document.getElementById("kpi-sota").textContent = sota ? fmtPct(sota.accuracy) : "–";
  }

  /* ---------- Pareto chart ---------- */
  function renderChart(rows) {
    var el = document.getElementById("pareto-chart");
    var emptyEl = document.getElementById("chart-empty");
    if (typeof echarts === "undefined") {
      // CDN may still be loading (deferred scripts) — retry once on window load.
      if (!renderChart._retried) {
        renderChart._retried = true;
        window.addEventListener("load", function () { renderChart(rows); });
        return;
      }
      el.innerHTML = '<p class="muted mono" style="padding:40px">chart library failed to load.</p>';
      return;
    }
    var measured = rows.filter(function (r) {
      return r.kind === "measured" && xVal(r) != null && r.accuracy != null;
    });
    var paper = rows.filter(function (r) { return r.kind === "paper"; });
    emptyEl.hidden = measured.length > 0;

    if (chart) chart.dispose();
    chart = echarts.init(el);

    var maxTok = measured.reduce(function (m, r) { return Math.max(m, r.total_tokens || 0); }, 1);
    var data = measured.map(function (r) {
      return {
        value: [xVal(r), +(r.accuracy * 100).toFixed(2)],
        symbolSize: 14 + 34 * Math.sqrt((r.total_tokens || 0) / maxTok),
        name: archLabel(r.architecture) + (r.variant ? " — " + r.variant : ""),
        itemStyle: { color: GREEN }
      };
    });

    var markLines = paper.filter(function (r) { return r.accuracy != null; }).map(function (r) {
      return {
        yAxis: +(r.accuracy * 100).toFixed(2),
        lineStyle: { color: AMBER, type: "dashed", width: 1.5 },
        label: { formatter: archLabel(r.architecture) + " (paper) " + fmtPct(r.accuracy),
                 color: AMBER, fontFamily: "IBM Plex Mono", fontSize: 11,
                 position: "insideEndTop" }
      };
    });

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 56, right: 30, top: 30, bottom: 48 },
      xAxis: {
        type: "value", name: xLabel(), nameLocation: "middle", nameGap: 34,
        nameTextStyle: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLabel: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLine: { lineStyle: { color: HAIR } }, splitLine: { lineStyle: { color: HAIR } }
      },
      yAxis: {
        type: "value", name: "accuracy (%)", min: 0, max: 100,
        nameTextStyle: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11 },
        axisLabel: { color: MUTED, fontFamily: "IBM Plex Mono", fontSize: 11, formatter: "{value}%" },
        axisLine: { lineStyle: { color: HAIR } }, splitLine: { lineStyle: { color: HAIR } }
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "#10161e", borderColor: HAIR, textStyle: { color: INK, fontSize: 12 },
        formatter: function (p) {
          var r = measured[p.dataIndex];
          return "<b>" + esc(p.name) + "</b><br>" +
            xLabel() + ": <b>" + p.value[0] + "</b><br>" +
            "accuracy: <b>" + p.value[1] + "%</b><br>" +
            "tokens: " + (r.total_tokens || "–").toLocaleString() + "<br>" +
            "n = " + r.n + " · " + esc(r.date || "");
        }
      },
      series: [{
        type: "scatter", data: data,
        emphasis: { scale: 1.25 },
        markLine: markLines.length ? { silent: true, symbol: "none", data: markLines } : undefined
      }],
      animationDuration: 900
    });
    window.addEventListener("resize", function () { chart.resize(); });
  }

  /* ---------- Cards ---------- */
  function cardHTML(r, isTop) {
    var chips = (r.models || []).map(function (m) {
      return '<span class="chip">' + esc(m) + "</span>";
    }).join("");
    return '<article class="card reveal' + (isTop ? " top" : "") + '">' +
      '<div class="card-head"><div><div class="card-title">' + esc(archLabel(r.architecture)) + "</div>" +
      (r.variant ? '<div class="card-variant">' + esc(r.variant) + "</div>" : "") + "</div>" +
      badge(r.kind) + "</div>" +
      '<div class="acc">' + fmtPct(r.accuracy) + " <small>accuracy</small></div>" +
      '<div class="stat-row">' +
        "<div class='stat'><b>" + fmtLat(r.mean_latency_s) + "</b><span>latency / q</span></div>" +
        "<div class='stat'><b>" + fmtCost(r.cost_usd) + "</b><span>cost / run</span></div>" +
        "<div class='stat'><b>" + (r.total_tokens != null ? r.total_tokens.toLocaleString() : "–") + "</b><span>tokens</span></div>" +
        "<div class='stat'><b>n=" + r.n + "</b><span>questions</span></div>" +
      "</div>" +
      (chips ? '<div class="model-chips">' + chips + "</div>" : "") +
      (r.notes ? '<p class="card-notes">' + esc(r.notes) + "</p>" : "") +
      '<p class="card-src">' + esc(r.source || "") + (r.date ? " · " + esc(r.date) : "") + "</p>" +
    "</article>";
  }

  function renderCards(rows) {
    var best = -1;
    rows.forEach(function (r) {
      if (r.kind === "measured" && r.accuracy != null && r.accuracy > best) best = r.accuracy;
    });
    document.getElementById("cards").innerHTML = rows.map(function (r) {
      return cardHTML(r, r.kind === "measured" && r.accuracy === best && best >= 0);
    }).join("");
  }

  function renderPending(pending) {
    var sec = document.getElementById("bench");
    if (!pending || !pending.length) { sec.hidden = true; return; }
    sec.hidden = false;
    document.getElementById("pending-cards").innerHTML = pending.map(function (p) {
      return '<article class="card reveal"><div class="card-head"><div>' +
        '<div class="card-title">' + esc(archLabel(p.architecture)) + "</div>" +
        '<div class="card-variant">' + esc(p.variant || "") + "</div></div>" +
        badge("pending") + "</div>" +
        '<p class="card-notes">' + esc(p.detail || "") + "</p></article>";
    }).join("");
  }

  /* ---------- Run table ---------- */
  function renderTable(rows) {
    var tb = document.querySelector("#runs-table tbody");
    tb.innerHTML = rows.map(function (r) {
      return "<tr><td><span class='mono'>" + esc(r.id) + "</span></td>" +
        "<td>" + esc(archLabel(r.architecture)) + "</td>" +
        "<td class='num'>" + r.n + "</td>" +
        "<td class='num'>" + fmtPct(r.accuracy) + "</td>" +
        "<td class='num'>" + fmtLat(r.mean_latency_s) + "</td>" +
        "<td class='num'>" + fmtCost(r.cost_usd) + "</td>" +
        "<td>" + badge(r.kind) + "</td></tr>";
    }).join("");
  }

  /* ---------- Reveal on scroll ---------- */
  function observeReveals() {
    var els = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
    // Reveal anything already in the viewport synchronously (robust under
    // virtual-time rendering and if IntersectionObserver ever misfires).
    function inView(el) {
      var r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.96 && r.bottom > 0;
    }
    function revealVisible() {
      els = els.filter(function (el) {
        if (inView(el)) { el.classList.add("visible"); return false; }
        return true;
      });
    }
    revealVisible();
    if (!("IntersectionObserver" in window)) { revealVisible(); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visible"); io.unobserve(e.target);
          els = els.filter(function (el) { return el !== e.target; });
        }
      });
    }, { threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
    window.addEventListener("scroll", revealVisible, { passive: true });
  }

  /* ---------- Boot ---------- */
  fetch(DATA_URL)
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      leaderboard = data;
      renderKPIs(data.rows);
      renderChart(data.rows);
      renderCards(data.rows);
      renderPending(data.pending);
      renderTable(data.rows);
      document.getElementById("pareto-metric-word").textContent = metric;
      if (data.generated_utc) {
        document.getElementById("generated").textContent =
          "data compiled " + data.generated_utc.slice(0, 10);
      }
      observeReveals();
    })
    .catch(function (err) {
      document.getElementById("cards").innerHTML =
        '<p class="muted mono">Could not load leaderboard data (' + esc(err.message) + ").</p>";
    });

  document.querySelectorAll(".toggle-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".toggle-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      metric = btn.getAttribute("data-metric");
      document.getElementById("pareto-metric-word").textContent = metric;
      if (leaderboard) renderChart(leaderboard.rows);
    });
  });
})();

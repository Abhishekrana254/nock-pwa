const canvas = document.querySelector("#c");
const ctx = canvas.getContext("2d");
const BEST = "nock-level";
const params = new URLSearchParams(location.search);
const reel = params.get("reel") === "1";
const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

let level = reel ? 40 : Math.max(1, Number(params.get("level") || localStorage.getItem(BEST) || 1));
let rows = 8;
let cols = 6;
let arrows = [];
let hearts = 3;
let rank = "Easy";
let busy = null;
let shake = null;
let cleared = false;
let resetIn = 0;
let nextIn = 0;
let reelStep = 0;
let reelWait = 1.35;
let actx;

function bootAudio() {
  if (!actx) actx = new AudioContext();
  return actx.resume();
}
function tone(freq, dur, gain, type = "sine") {
  if (!actx) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(actx.destination);
  const t = actx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise(dur, gain, freq) {
  if (!actx) return;
  const n = Math.max(1, Math.floor(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource();
  const filter = actx.createBiquadFilter();
  const g = actx.createGain();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(filter);
  filter.connect(g);
  g.connect(actx.destination);
  src.start();
}
function playExit() {
  noise(0.07, 0.22, 1800);
  tone(620, 0.06, 0.05);
  tone(880, 0.09, 0.04);
}
function playFail() {
  noise(0.1, 0.18, 280);
  tone(150, 0.16, 0.1, "triangle");
}
function playClear() {
  [523, 659, 784, 1046].forEach((freq, i) => {
    setTimeout(() => tone(freq, 0.14, 0.06), i * 80);
  });
}

function view() {
  return { w: canvas.clientWidth, h: canvas.clientHeight };
}
function resize() {
  const r = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * r));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * r));
  ctx.setTransform(r, 0, 0, r, 0, 0);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function key(r, c) {
  return `${r},${c}`;
}
function inside(r, c) {
  return r >= 0 && c >= 0 && r < rows && c < cols;
}
function headOf(arrow) {
  return arrow.cells[arrow.cells.length - 1];
}
function canExit(arrow, all = arrows) {
  const occ = new Set();
  for (const other of all) {
    if (other.id === arrow.id || other.gone) continue;
    for (const cell of other.cells) occ.add(key(cell.r, cell.c));
  }
  const head = headOf(arrow);
  let r = head.r + arrow.dr;
  let c = head.c + arrow.dc;
  while (inside(r, c)) {
    if (occ.has(key(r, c))) return false;
    r += arrow.dr;
    c += arrow.dc;
  }
  return true;
}
function rankOf(stage) {
  if (stage < 5) return "Easy";
  if (stage < 16) return "Normal";
  return "Hard";
}
function sizeOf(stage) {
  const colsN = Math.min(18, 6 + Math.floor((stage - 1) * 0.28));
  const rowsN = Math.min(26, 8 + Math.floor((stage - 1) * 0.4));
  return { rows: rowsN, cols: colsN };
}

function makeLevel(stage) {
  const size = sizeOf(stage);
  const rand = mulberry32(stage * 9973 + 17);
  const fill = 0.5 + Math.min(0.22, stage * 0.005);
  const minLen = stage < 4 ? 2 : 3;
  const maxLen = Math.min(18, 5 + Math.floor(stage / 2));
  let best = null;
  const target = Math.floor(size.rows * size.cols * fill);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    rows = size.rows;
    cols = size.cols;
    const occ = new Set();
    const rayCells = new Set();
    const list = [];
    const spots = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) spots.push([r, c]);
    }
    spots.sort((a, b) => {
      const da = Math.hypot(a[0] - rows / 2, a[1] - cols / 2);
      const db = Math.hypot(b[0] - rows / 2, b[1] - cols / 2);
      return da - db + (rand() - 0.5) * 3;
    });
    const place = (hr, hc, dir) => {
      if (occ.has(key(hr, hc))) return false;
      let rr = hr + dir.dr;
      let cc = hc + dir.dc;
      while (inside(rr, cc)) {
        if (occ.has(key(rr, cc))) return false;
        rr += dir.dr;
        cc += dir.dc;
      }
      const br = hr - dir.dr;
      const bc = hc - dir.dc;
      if (!inside(br, bc) || occ.has(key(br, bc))) return false;
      const want = minLen + Math.floor(rand() * (maxLen - minLen + 1));
      const cells = [{ r: hr, c: hc }, { r: br, c: bc }];
      let r = br;
      let c = bc;
      let bdr = -dir.dr;
      let bdc = -dir.dc;
      const used = new Set([key(hr, hc), key(br, bc)]);
      while (cells.length < want) {
        const options = [];
        for (const [ndr, ndc] of [[bdr, bdc], [bdc, -bdr], [-bdc, bdr]]) {
          const nr = r + ndr;
          const nc = c + ndc;
          const idk = key(nr, nc);
          if (!inside(nr, nc) || occ.has(idk) || used.has(idk)) continue;
          if (dir.dc === 0 && nc === hc && (dir.dr > 0 ? nr > hr : nr < hr)) continue;
          if (dir.dr === 0 && nr === hr && (dir.dc > 0 ? nc > hc : nc < hc)) continue;
          options.push([nr, nc, ndr, ndc, rayCells.has(idk)]);
        }
        if (!options.length) break;
        const blockers = options.filter((item) => item[4]);
        const straight = options.filter((item) => item[2] === bdr && item[3] === bdc);
        let pick = options[Math.floor(rand() * options.length)];
        if (blockers.length) pick = blockers[Math.floor(rand() * blockers.length)];
        else if (straight.length && rand() < 0.62) pick = straight[0];
        r = pick[0];
        c = pick[1];
        bdr = pick[2];
        bdc = pick[3];
        used.add(key(r, c));
        cells.push({ r, c });
      }
      if (cells.length < minLen) return false;
      for (const cell of cells) occ.add(key(cell.r, cell.c));
      rr = hr + dir.dr;
      cc = hc + dir.dc;
      while (inside(rr, cc)) {
        rayCells.add(key(rr, cc));
        rr += dir.dr;
        cc += dir.dc;
      }
      cells.reverse();
      list.push({ id: list.length + 1, cells, dr: dir.dr, dc: dir.dc, gone: false });
      return true;
    };
    for (const [hr, hc] of spots) {
      if (occ.size >= target) break;
      const dirs = [...DIRS].sort(() => rand() - 0.5);
      for (const dir of dirs) {
        if (place(hr, hc, dir)) break;
      }
    }
    const free = list.filter((arrow) => canExit(arrow, list)).length;
    if (list.length >= 4 && free >= 1) {
      const packed = { list, rows: size.rows, cols: size.cols, rank: rankOf(stage), score: occ.size };
      if (!best || packed.score > best.score) best = packed;
      if (occ.size >= target * 0.8) break;
    }
  }
  if (best) return best;
  rows = 6;
  cols = 5;
  const fallback = [
    { id: 1, dr: 0, dc: 1, cells: [{ r: 1, c: 0 }, { r: 1, c: 1 }, { r: 1, c: 2 }] },
    { id: 2, dr: 1, dc: 0, cells: [{ r: 0, c: 4 }, { r: 1, c: 4 }, { r: 2, c: 4 }] },
    { id: 3, dr: 0, dc: -1, cells: [{ r: 3, c: 3 }, { r: 3, c: 2 }, { r: 4, c: 2 }, { r: 4, c: 1 }] },
    { id: 4, dr: -1, dc: 0, cells: [{ r: 5, c: 0 }, { r: 4, c: 0 }, { r: 3, c: 0 }] },
  ];
  return { list: fallback.map((arrow) => ({ ...arrow, gone: false })), rows: 6, cols: 5, rank: "Easy" };
}

function build() {
  const made = makeLevel(level);
  rows = made.rows;
  cols = made.cols;
  arrows = made.list;
  rank = made.rank;
  window.__stats = { cells: made.score || 0 };
  hearts = 3;
  busy = null;
  shake = null;
  cleared = false;
  resetIn = 0;
  nextIn = 0;
}

function board() {
  const { w, h } = view();
  const top = 86;
  const cell = Math.min((w - 20) / cols, (h - top - 18) / rows);
  const bw = cell * cols;
  const bh = cell * rows;
  return { x0: (w - bw) / 2, y0: top + Math.max(0, (h - top - 18 - bh) / 2), cell };
}
function center(cell, b, r, c) {
  return { x: b.x0 + (c + 0.5) * cell, y: b.y0 + (r + 0.5) * cell };
}

function trackOf(arrow, b) {
  const pts = arrow.cells.map((cellPos) => center(b.cell, b, cellPos.r, cellPos.c));
  const head = pts[pts.length - 1];
  const { w, h } = view();
  const reach = Math.hypot(w, h) + b.cell * (arrow.cells.length + 2);
  pts.push({ x: head.x + arrow.dc * reach, y: head.y + arrow.dr * reach });
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, body: cum[cum.length - 2], reach };
}
function launch(arrow) {
  if (busy || arrow.gone || shake) return;
  const track = trackOf(arrow, board());
  const speed = 680;
  busy = {
    id: arrow.id,
    t: 0,
    dur: Math.min(1.35, Math.max(0.62, (track.body + track.reach * 0.72) / speed)),
    ...track,
  };
  playExit();
}
function mistake(arrow) {
  if (busy || shake || arrow.gone) return;
  hearts -= 1;
  shake = { id: arrow.id, t: reel ? 1.5 : 0.4 };
  playFail();
  if (hearts <= 0 && !reel) resetIn = 0.75;
}
function restart() {
  build();
}

function point(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function arrowAt(x, y) {
  const b = board();
  let best = null;
  let bestD = b.cell * 0.62;
  for (const arrow of arrows) {
    if (arrow.gone || (busy && busy.id === arrow.id)) continue;
    for (let i = 1; i < arrow.cells.length; i += 1) {
      const a = center(b.cell, b, arrow.cells[i - 1].r, arrow.cells[i - 1].c);
      const p = center(b.cell, b, arrow.cells[i].r, arrow.cells[i].c);
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
      const dist = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
      if (dist < bestD) {
        bestD = dist;
        best = arrow;
      }
    }
  }
  return best;
}

function pointAlong(pts, cum, dist) {
  const d = Math.max(0, Math.min(cum[cum.length - 1] - 0.01, dist));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i += 1;
  const span = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / span;
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
    dx: pts[i].x - pts[i - 1].x,
    dy: pts[i].y - pts[i - 1].y,
  };
}
function drawAlong(pts, cum, from, to, cell, color) {
  const tail = pointAlong(pts, cum, from);
  const head = pointAlong(pts, cum, to);
  ctx.save();
  ctx.lineWidth = Math.max(2.2, cell * 0.2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  for (let i = 1; i < pts.length - 1; i += 1) {
    if (cum[i] > from + 0.4 && cum[i] < to - 0.4) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.lineTo(head.x, head.y);
  ctx.stroke();
  ctx.translate(head.x, head.y);
  ctx.rotate(Math.atan2(head.dy, head.dx));
  const tip = cell * 0.46;
  const wing = cell * 0.28;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.lineTo(-wing * 0.15, wing);
  ctx.lineTo(-wing * 0.15, -wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawArrow(arrow, b, color, ox, oy) {
  const { cell } = b;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.lineWidth = Math.max(2.2, cell * 0.2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  arrow.cells.forEach((cellPos, index) => {
    const p = center(cell, b, cellPos.r, cellPos.c);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  const head = headOf(arrow);
  const p = center(cell, b, head.r, head.c);
  const ang = Math.atan2(arrow.dr, arrow.dc);
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  const tip = cell * 0.46;
  const wing = cell * 0.28;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.lineTo(-wing * 0.15, wing);
  ctx.lineTo(-wing * 0.15, -wing);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function draw() {
  const { w, h } = view();
  const b = board();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#111";
  ctx.font = "700 28px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(level), w / 2, 30);
  ctx.fillStyle = rank === "Hard" ? "#2563eb" : rank === "Normal" ? "#0f766e" : "#64748b";
  ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(rank, w / 2, 54);

  ctx.font = "22px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = i < hearts ? "#e11d48" : "#e5e7eb";
    ctx.fillText("♥", w - 14 - (2 - i) * 24, 36);
  }

  ctx.strokeStyle = "#e5e7eb";
  ctx.fillStyle = "#f3f4f6";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(36, 36, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(36, 36, 7, Math.PI * 0.2, Math.PI * 1.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(42, 28);
  ctx.lineTo(46, 34);
  ctx.lineTo(38, 34);
  ctx.closePath();
  ctx.fillStyle = "#374151";
  ctx.fill();

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const p = center(b.cell, b, r, c);
      ctx.fillStyle = "#ececef";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.1, b.cell * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const fly = busy ? arrows.find((arrow) => arrow.id === busy.id) : null;
  for (const arrow of arrows) {
    if (arrow.gone || arrow === fly) continue;
    let ox = 0;
    let oy = 0;
    let color = "#161616";
    if (shake && shake.id === arrow.id) {
      ox = Math.sin(shake.t * 70) * 5;
      color = "#dc2626";
    }
    drawArrow(arrow, b, color, ox, oy);
  }
  if (fly && busy) {
    const k = busy.t / busy.dur;
    const s = k * k * (3 - 2 * k);
    const dist = s * (busy.body + busy.reach * 0.72);
    drawAlong(busy.pts, busy.cum, dist, dist + busy.body, b.cell, "#2563eb");
  }
  if (cleared) {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.font = "800 42px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("CLEAR", w / 2, h * 0.48);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (busy) {
    busy.t += dt;
    if (busy.t >= busy.dur) {
      const arrow = arrows.find((item) => item.id === busy.id);
      if (arrow) arrow.gone = true;
      busy = null;
      if (arrows.every((item) => item.gone)) {
        cleared = true;
        if (!reel) {
          playClear();
          const next = level + 1;
          localStorage.setItem(BEST, String(next));
          nextIn = 0.7;
        }
      }
    }
  }
  if (shake) {
    shake.t -= dt;
    if (shake.t <= 0) shake = null;
  }
  if (resetIn > 0) {
    resetIn -= dt;
    if (resetIn <= 0) build();
  }
  if (nextIn > 0) {
    nextIn -= dt;
    if (nextIn <= 0) {
      level += 1;
      build();
    }
  }
  if (reel && !document.documentElement.dataset.reel && !busy && !shake) {
    reelWait -= dt;
    const ready = reelWait <= 0;
    if (ready && reelStep < 5) {
      const free = arrows.find((arrow) => !arrow.gone && canExit(arrow));
      if (free) {
        launch(free);
        reelStep += 1;
        reelWait = 0.22;
      } else reelStep = 5;
    } else if (ready && reelStep === 5) {
      const blocked = arrows
        .filter((arrow) => !arrow.gone && !canExit(arrow))
        .sort((a, b) => b.cells.length - a.cells.length)[0];
      if (blocked) mistake(blocked);
      reelStep = 6;
      reelWait = 1.7;
    } else if (ready && reelStep === 6) {
      document.documentElement.dataset.reel = "done";
    }
  }
  draw();
  const left = arrows.filter((arrow) => !arrow.gone).length;
  window.__nock = {
    level,
    hearts,
    left,
    rank,
    rows,
    cols,
    free: arrows.filter((arrow) => !arrow.gone && canExit(arrow)).length,
    cells: window.__stats && window.__stats.cells,
    spot: (() => {
      const open = arrows.find((arrow) => !arrow.gone && canExit(arrow));
      return open ? headOf(open) : null;
    })(),
    bad: (() => {
      const shut = arrows.find((arrow) => !arrow.gone && !canExit(arrow));
      return shut ? headOf(shut) : null;
    })(),
  };
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", (e) => {
  bootAudio();
  if (reel || cleared || busy) return;
  const p = point(e);
  if (p.x < 64 && p.y < 72) {
    restart();
    return;
  }
  const hit = arrowAt(p.x, p.y);
  if (!hit) return;
  if (canExit(hit)) launch(hit);
  else mistake(hit);
});
addEventListener("resize", resize);
resize();
build();
requestAnimationFrame(frame);

import { parseWorkbook } from "./parser.js";
import { parseGenesisMht } from "./genesis.js";

const $ = (id) => document.getElementById(id);
const FILTERS = ["q", "desde", "hasta", "hoja", "periodo", "pago", "monto_min", "monto_max"];
const state = { page: 1, size: 50, sort: "fecha", dir: "desc", total: 0 };
const money = (n) => new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function params(extra = {}) {
  const p = new URLSearchParams();
  for (const k of FILTERS) if ($(k).value) p.set(k, $(k).value);
  if ($("sin_contacto").checked) p.set("sin_contacto", "1");
  p.set("sort", state.sort); p.set("dir", state.dir);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}

async function load() {
  const d = await api("/api/altas?" + params({ page: state.page, size: state.size }));
  state.total = d.total;
  const pages = Math.max(1, Math.ceil(d.total / state.size));
  $("info").textContent = `${d.total} resultado(s)`;
  $("pageInfo").textContent = `Página ${state.page} de ${pages}`;
  $("prev").disabled = state.page <= 1;
  $("next").disabled = state.page >= pages;
  $("rows").innerHTML = d.rows.map((r) => `
    <tr>
      <td>${esc(r.cuenta)}</td>
      <td>${esc(r.fecha_instalacion)}</td>
      <td>${esc(r.nombre)}</td>
      <td>${[r.telefono1, r.telefono2].filter(Boolean).map(esc).join(" · ")}<div class="small">${esc(r.email)}</div></td>
      <td>${esc(r.hoja)}</td>
      <td>${r.pagos.map((p) => `<span class="chip" title="${p.periodo}">${p.periodo.slice(2)}: ${money(p.monto)}</span>`).join("") || '<span class="small">—</span>'}</td>
      <td class="num">${r.n_pagos ? money(r.total_pagado) : ""}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="muted">Sin resultados</td></tr>';
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("asc", th.dataset.sort === state.sort && state.dir === "asc");
    th.classList.toggle("desc", th.dataset.sort === state.sort && state.dir === "desc");
  });
}

async function loadStats() {
  const s = await api("/api/stats");
  $("stats").textContent = `${s.altas} altas · cobrado total ${money(s.monto)}`;
  const fill = (sel, items, val, label) => {
    const cur = sel.value;
    sel.length = 1;
    for (const i of items) sel.add(new Option(label(i), val(i)));
    sel.value = cur;
  };
  fill($("hoja"), s.hojas.filter((h) => h.hoja), (h) => h.hoja, (h) => `${h.hoja} (${h.n})`);
  fill($("periodo"), s.periodos, (p) => p.periodo, (p) => `${p.periodo} (${p.n})`);
}

let t;
const reload = () => { state.page = 1; load().catch(alert); };
for (const k of FILTERS) $(k).addEventListener("input", () => { clearTimeout(t); t = setTimeout(reload, k === "q" ? 250 : 0); });
$("sin_contacto").addEventListener("change", reload);
$("btnClear").onclick = () => { FILTERS.forEach((k) => ($(k).value = "")); $("sin_contacto").checked = false; reload(); };
$("prev").onclick = () => { state.page--; load(); };
$("next").onclick = () => { state.page++; load(); };
document.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
  state.dir = state.sort === th.dataset.sort && state.dir === "desc" ? "asc" : "desc";
  state.sort = th.dataset.sort; state.page = 1; load();
}));

$("btnCsv").onclick = async () => {
  const d = await api("/api/altas?" + params({ page: 1, size: 200 }));
  let rows = d.rows;
  for (let p = 2; p <= Math.ceil(d.total / 200); p++) rows = rows.concat((await api("/api/altas?" + params({ page: p, size: 200 }))).rows);
  const head = ["cuenta", "fecha_instalacion", "nombre", "email", "telefono1", "telefono2", "hoja", "total_pagado", "cobros"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head.join(",")].concat(rows.map((r) =>
    [r.cuenta, r.fecha_instalacion, r.nombre, r.email, r.telefono1, r.telefono2, r.hoja, r.total_pagado, r.pagos.map((p) => `${p.periodo}=${p.monto}`).join(";")].map(cell).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "altas.csv"; a.click();
};

// ---- Importación ----
let pending = [];
$("btnImport").onclick = () => { pending = []; $("preview").textContent = ""; $("btnGo").disabled = true; $("file").value = ""; $("prog").hidden = true; $("dlg").showModal(); };
$("btnCancel").onclick = () => $("dlg").close();
$("file").onchange = async (e) => {
  pending = []; let txt = "";
  for (const f of e.target.files) {
    const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
    const { rows, resumen } = parseWorkbook(XLSX, wb, f.name);
    pending.push(...rows);
    txt += `${f.name}\n` + resumen.map((r) => `  ${r.hoja}: ${r.n} altas${r.nota ? " (" + r.nota + ")" : ""}`).join("\n") + "\n";
  }
  $("preview").textContent = txt + `\nTotal a importar: ${pending.length}`;
  $("btnGo").disabled = !pending.length;
};
$("btnGo").onclick = async () => {
  $("btnGo").disabled = true; $("prog").hidden = false; $("prog").max = pending.length; $("prog").value = 0;
  try {
    for (let i = 0; i < pending.length; i += 40) {
      await api("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: pending.slice(i, i + 40) }) });
      $("prog").value = Math.min(i + 40, pending.length);
    }
    $("preview").textContent += "\n✔ Importación completa";
    await loadStats(); reload();
  } catch (err) { $("preview").textContent += "\n✖ " + err.message; }
};

// ---- Comparar con Genesis ----
const ESTADOS = {
  "": "Todos", solo_genesis: "Solo en Genesis", solo_planilla: "Solo en planilla",
  posible: "Posible coincidencia", difiere: "Difiere", coincide: "Coinciden", fuera_rango: "Fuera de rango",
};
const cs = { page: 1, size: 100, estado: "solo_genesis", loaded: false };

const gs = { page: 1, size: 50, sort: "fecha", dir: "desc", loaded: false };

function setTab(tab) {
  for (const [name, view, btn] of [["altas", "viewAltas", "tabAltas"], ["gen", "viewGen", "tabGen"], ["comp", "viewComp", "tabComp"]]) {
    $(view).hidden = name !== tab;
    $(btn).classList.toggle("active", name === tab);
  }
  $("btnImport").hidden = tab !== "altas";
  if (tab === "comp" && !cs.loaded) loadComp().catch(alert);
  if (tab === "gen" && !gs.loaded) loadGen().catch(alert);
}
$("tabAltas").onclick = () => setTab("altas");
$("tabGen").onclick = () => setTab("gen");
$("tabComp").onclick = () => setTab("comp");

// ---- Búsqueda en Genesis ----
const GF = ["gq", "gdesde", "ghasta", "gplan", "gplanilla"];
const gParams = (extra = {}) => {
  const p = new URLSearchParams();
  const map = { gq: "q", gdesde: "desde", ghasta: "hasta", gplan: "plan", gplanilla: "planilla" };
  for (const k of GF) if ($(k).value) p.set(map[k], $(k).value);
  p.set("sort", gs.sort); p.set("dir", gs.dir);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
};

async function loadGenPlanes() {
  const s = await api("/api/genesis/stats");
  const cur = $("gplan").value;
  $("gplan").length = 1;
  for (const p of s.planes) $("gplan").add(new Option(`${p.plan} (${p.n})`, p.plan));
  $("gplan").value = cur;
  return s;
}

async function loadGen() {
  const [d, s] = await Promise.all([api("/api/genesis?" + gParams({ page: gs.page, size: gs.size })), loadGenPlanes()]);
  gs.loaded = true;
  const pages = Math.max(1, Math.ceil(d.total / gs.size));
  $("gInfo").textContent = s.n
    ? `${d.total} resultado(s) de ${s.n} · periodo ${s.min} → ${s.max}`
    : "Aún no hay datos de Genesis. Sube el archivo .mht.";
  $("gPageInfo").textContent = `Página ${gs.page} de ${pages}`;
  $("gPrev").disabled = gs.page <= 1; $("gNext").disabled = gs.page >= pages;
  $("gRows").innerHTML = d.rows.map((r) => `
    <tr>
      <td>${esc(r.cuenta)}</td>
      <td>${esc(r.fecha_alta)}</td>
      <td>${esc(r.nombre)}</td>
      <td>${esc(r.carnet)}</td>
      <td>${esc(r.solicitud)}</td>
      <td>${esc(r.reserva)}</td>
      <td>${esc(r.plan)}</td>
      <td class="small">${esc(r.direccion)}</td>
      <td>${r.en_planilla ? `<span class="st st-coincide">Sí${r.hoja_planilla ? " · " + esc(r.hoja_planilla) : ""}</span>` : '<span class="st st-solo_genesis">No</span>'}</td>
    </tr>`).join("") || '<tr><td colspan="9" class="muted">Sin resultados</td></tr>';
  document.querySelectorAll("th[data-gsort]").forEach((th) => {
    th.classList.toggle("asc", th.dataset.gsort === gs.sort && gs.dir === "asc");
    th.classList.toggle("desc", th.dataset.gsort === gs.sort && gs.dir === "desc");
  });
}
let gt;
const gReload = () => { gs.page = 1; loadGen().catch(alert); };
for (const k of GF) $(k).addEventListener("input", () => { clearTimeout(gt); gt = setTimeout(gReload, k === "gq" ? 250 : 0); });
$("gClear").onclick = () => { GF.forEach((k) => ($(k).value = "")); gReload(); };
$("gPrev").onclick = () => { gs.page--; loadGen(); };
$("gNext").onclick = () => { gs.page++; loadGen(); };
document.querySelectorAll("th[data-gsort]").forEach((th) => (th.onclick = () => {
  gs.dir = gs.sort === th.dataset.gsort && gs.dir === "desc" ? "asc" : "desc";
  gs.sort = th.dataset.gsort; gs.page = 1; loadGen();
}));
$("gCsv").onclick = async () => {
  const d = await api("/api/genesis?" + gParams({ all: 1 }));
  const head = ["cuenta", "fecha_alta", "nombre", "carnet", "solicitud", "reserva", "plan", "direccion", "en_planilla", "hoja_planilla"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head.join(",")].concat(d.rows.map((r) => head.map((h) => cell(r[h])).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "genesis.csv"; a.click();
};

const cParams = (extra = {}) => {
  const p = new URLSearchParams();
  if (cs.estado) p.set("estado", cs.estado);
  if ($("cq").value) p.set("q", $("cq").value);
  if ($("cdesde").value) p.set("desde", $("cdesde").value);
  if ($("chasta").value) p.set("hasta", $("chasta").value);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p;
};

async function loadComp() {
  const d = await api("/api/comparar?" + cParams({ page: cs.page, size: cs.size }));
  cs.loaded = true;
  const rg = (r) => (r ? `${r.min} → ${r.max}` : "sin datos");
  $("cRangos").textContent = `Periodo planilla: ${rg(d.rangoPlanilla)} · Periodo Genesis: ${rg(d.rangoGenesis)}`;
  const total = Object.values(d.resumen).reduce((a, b) => a + b, 0);
  $("cChips").innerHTML = Object.entries(ESTADOS).map(([k, v]) =>
    `<button data-e="${k}" class="${cs.estado === k ? "on" : ""}">${v} (${k ? d.resumen[k] || 0 : total})</button>`).join("");
  $("cChips").querySelectorAll("button").forEach((b) => (b.onclick = () => { cs.estado = b.dataset.e; cs.page = 1; loadComp(); }));
  const pages = Math.max(1, Math.ceil(d.total / cs.size));
  $("cPageInfo").textContent = `${d.total} fila(s) · Página ${cs.page} de ${pages}`;
  $("cPrev").disabled = cs.page <= 1; $("cNext").disabled = cs.page >= pages;
  $("cRows").innerHTML = d.rows.map((r) => `
    <tr>
      <td><span class="st st-${r.estado}">${ESTADOS[r.estado]}</span></td>
      <td>${esc(r.cuenta)}${r.cuenta_genesis && r.cuenta_genesis !== r.cuenta ? `<div class="small">Genesis: ${esc(r.cuenta_genesis)}</div>` : ""}</td>
      <td>${esc(r.fecha_planilla)}${r.hoja ? `<div class="small">${esc(r.hoja)}</div>` : ""}</td>
      <td>${esc(r.fecha_genesis)}</td>
      <td>${esc(r.nombre_planilla)}</td>
      <td>${esc(r.nombre_genesis)}</td>
      <td>${esc(r.carnet)}</td>
      <td>${esc(r.plan)}</td>
      <td class="small">${esc(r.nota)}</td>
    </tr>`).join("") || '<tr><td colspan="9" class="muted">Sin resultados. ¿Subiste el archivo de Genesis?</td></tr>';
}
let ct;
for (const k of ["cq", "cdesde", "chasta"]) $(k).addEventListener("input", () => { clearTimeout(ct); ct = setTimeout(() => { cs.page = 1; loadComp().catch(alert); }, 250); });
$("cClear").onclick = () => { ["cq", "cdesde", "chasta"].forEach((k) => ($(k).value = "")); cs.page = 1; loadComp(); };
$("cPrev").onclick = () => { cs.page--; loadComp(); };
$("cNext").onclick = () => { cs.page++; loadComp(); };
$("cCsv").onclick = async () => {
  const d = await api("/api/comparar?" + cParams({ all: 1 }));
  const head = ["estado", "cuenta", "cuenta_genesis", "fecha_planilla", "fecha_genesis", "nombre_planilla", "nombre_genesis", "hoja", "carnet", "plan", "direccion", "nota"];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [head.join(",")].concat(d.rows.map((r) => head.map((h) => cell(r[h])).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = "comparacion.csv"; a.click();
};

let gPending = [];
$("btnGenesis").onclick = $("btnGenesis2").onclick = () => { gPending = []; $("gpreview").textContent = ""; $("gfile").value = ""; $("gGo").disabled = true; $("gdlg").showModal(); };
$("gCancel").onclick = () => $("gdlg").close();
$("gfile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    gPending = parseGenesisMht(await f.arrayBuffer(), f.name);
    const fechas = gPending.map((r) => r.fecha).filter(Boolean).sort();
    $("gpreview").textContent = `${f.name}\n${gPending.length} altas · ${fechas[0]} → ${fechas.at(-1)}`;
    $("gGo").disabled = !gPending.length;
  } catch (err) { gPending = []; $("gpreview").textContent = "✖ " + err.message; $("gGo").disabled = true; }
};
$("gGo").onclick = async () => {
  $("gGo").disabled = true;
  try {
    for (let i = 0; i < gPending.length; i += 40)
      await api("/api/genesis/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: gPending.slice(i, i + 40) }) });
    $("gpreview").textContent += "\n✔ Importación completa";
    cs.page = 1; gs.page = 1;
    await Promise.all([loadComp(), loadGen()]);
  } catch (err) { $("gpreview").textContent += "\n✖ " + err.message; }
};

loadStats().then(load).catch((e) => ($("info").textContent = "Error: " + e.message));

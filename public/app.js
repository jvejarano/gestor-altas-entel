import { parseWorkbook } from "./parser.js";

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

loadStats().then(load).catch((e) => ($("info").textContent = "Error: " + e.message));

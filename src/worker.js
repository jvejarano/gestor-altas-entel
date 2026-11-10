const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const norm = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

const SORTS = {
  fecha: "a.fecha_instalacion",
  nombre: "a.nombre_norm",
  cuenta: "a.cuenta",
  hoja: "a.hoja",
  total: "total_pagado",
};

function buildWhere(p) {
  const w = [];
  const args = [];
  const q = p.get("q")?.trim();
  if (q) {
    // cada palabra debe aparecer en nombre / cuenta / contactos
    for (const t of norm(q).split(/\s+/).filter(Boolean)) {
      w.push(
        "(a.nombre_norm LIKE ? OR a.cuenta LIKE ? OR UPPER(IFNULL(a.email,'')) LIKE ? OR IFNULL(a.telefono1,'') LIKE ? OR IFNULL(a.telefono2,'') LIKE ?)"
      );
      const like = `%${t}%`;
      args.push(like, like, like, like, like);
    }
  }
  const desde = p.get("desde"), hasta = p.get("hasta");
  if (desde) { w.push("a.fecha_instalacion >= ?"); args.push(desde); }
  if (hasta) { w.push("a.fecha_instalacion <= ?"); args.push(hasta); }
  const hoja = p.get("hoja");
  if (hoja) { w.push("a.hoja = ?"); args.push(hoja); }
  const fuente = p.get("fuente");
  if (fuente) { w.push("a.fuente = ?"); args.push(fuente); }
  const periodo = p.get("periodo");
  const pago = p.get("pago"); // con | sin (opcionalmente en un periodo)
  if (pago === "con" || pago === "sin") {
    const sub = periodo
      ? "EXISTS (SELECT 1 FROM pagos x WHERE x.cuenta=a.cuenta AND x.periodo=?)"
      : "EXISTS (SELECT 1 FROM pagos x WHERE x.cuenta=a.cuenta)";
    w.push(pago === "con" ? sub : `NOT ${sub}`);
    if (periodo) args.push(periodo);
  } else if (periodo) {
    w.push("EXISTS (SELECT 1 FROM pagos x WHERE x.cuenta=a.cuenta AND x.periodo=?)");
    args.push(periodo);
  }
  const mmin = p.get("monto_min"), mmax = p.get("monto_max");
  if (mmin) { w.push("EXISTS (SELECT 1 FROM pagos x WHERE x.cuenta=a.cuenta AND x.monto>=?)"); args.push(+mmin); }
  if (mmax) { w.push("EXISTS (SELECT 1 FROM pagos x WHERE x.cuenta=a.cuenta AND x.monto<=?)"); args.push(+mmax); }
  if (p.get("sin_contacto") === "1")
    w.push("a.email IS NULL AND a.telefono1 IS NULL AND a.telefono2 IS NULL");
  return { where: w.length ? "WHERE " + w.join(" AND ") : "", args };
}

async function listAltas(env, url) {
  const p = url.searchParams;
  const { where, args } = buildWhere(p);
  const page = Math.max(1, +p.get("page") || 1);
  const size = Math.min(200, Math.max(1, +p.get("size") || 50));
  const sort = SORTS[p.get("sort")] || SORTS.fecha;
  const dir = p.get("dir") === "asc" ? "ASC" : "DESC";

  const total = await env.DB.prepare(`SELECT COUNT(*) n FROM altas a ${where}`).bind(...args).first("n");
  const { results } = await env.DB.prepare(
    `SELECT a.*,
       (SELECT IFNULL(SUM(monto),0) FROM pagos x WHERE x.cuenta=a.cuenta) AS total_pagado,
       (SELECT COUNT(*) FROM pagos x WHERE x.cuenta=a.cuenta) AS n_pagos
     FROM altas a ${where}
     ORDER BY ${sort} ${dir}, a.cuenta
     LIMIT ? OFFSET ?`
  ).bind(...args, size, (page - 1) * size).all();

  const ids = results.map((r) => r.cuenta);
  const pagos = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const r = await env.DB.prepare(
      `SELECT cuenta, periodo, monto FROM pagos WHERE cuenta IN (${ph}) ORDER BY periodo`
    ).bind(...ids).all();
    for (const x of r.results) (pagos[x.cuenta] ||= []).push({ periodo: x.periodo, monto: x.monto });
  }
  return json({ total, page, size, rows: results.map((r) => ({ ...r, pagos: pagos[r.cuenta] || [] })) });
}

async function importAltas(env, req) {
  const body = await req.json();
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > 200) return json({ error: "rows invalido (max 200)" }, 400);
  const stmts = [];
  for (const r of rows) {
    const cuenta = String(r.cuenta ?? "").trim();
    const nombre = String(r.nombre ?? "").trim();
    if (!cuenta || !nombre) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO altas (cuenta, fecha_instalacion, nombre, nombre_norm, email, telefono1, telefono2, hoja, archivo, fuente)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(cuenta) DO UPDATE SET
           fecha_instalacion=COALESCE(excluded.fecha_instalacion, fecha_instalacion),
           nombre=excluded.nombre, nombre_norm=excluded.nombre_norm,
           email=COALESCE(excluded.email, email),
           telefono1=COALESCE(excluded.telefono1, telefono1),
           telefono2=COALESCE(excluded.telefono2, telefono2),
           hoja=excluded.hoja, archivo=excluded.archivo,
           updated_at=datetime('now')`
      ).bind(
        cuenta, r.fecha || null, nombre, norm(nombre), r.email || null,
        r.telefono1 || null, r.telefono2 || null, r.hoja || null, r.archivo || null,
        r.fuente || "planilla"
      )
    );
    for (const pg of r.pagos || []) {
      if (!/^\d{4}-\d{2}$/.test(pg.periodo) || !isFinite(pg.monto)) continue;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO pagos (cuenta, periodo, monto) VALUES (?,?,?)
           ON CONFLICT(cuenta, periodo) DO UPDATE SET monto=excluded.monto`
        ).bind(cuenta, pg.periodo, +pg.monto)
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, procesadas: rows.length });
}

async function importGenesis(env, req) {
  const { rows } = await req.json();
  if (!Array.isArray(rows) || rows.length > 200) return json({ error: "rows invalido (max 200)" }, 400);
  const stmts = [];
  for (const r of rows) {
    const cuenta = String(r.cuenta ?? "").trim();
    const nombre = String(r.nombre ?? "").trim();
    if (!cuenta || !nombre) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO genesis (cuenta, fecha_alta, carnet, nombre, nombre_norm, solicitud, reserva, plan, direccion, archivo)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(cuenta) DO UPDATE SET
           fecha_alta=excluded.fecha_alta, carnet=excluded.carnet, nombre=excluded.nombre,
           nombre_norm=excluded.nombre_norm, solicitud=excluded.solicitud, reserva=excluded.reserva,
           plan=excluded.plan, direccion=excluded.direccion, archivo=excluded.archivo,
           updated_at=datetime('now')`
      ).bind(cuenta, r.fecha || null, r.carnet || null, nombre, norm(nombre), r.solicitud || null,
        r.reserva || null, r.plan || null, r.direccion || null, r.archivo || null)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, procesadas: rows.length });
}

const G_SORTS = { fecha: "g.fecha_alta", nombre: "g.nombre_norm", cuenta: "g.cuenta", carnet: "g.carnet", plan: "g.plan" };

async function listGenesis(env, url) {
  const p = url.searchParams;
  const w = [], args = [];
  const q = p.get("q")?.trim();
  if (q) {
    for (const t of norm(q).split(/\s+/).filter(Boolean)) {
      w.push(
        "(g.nombre_norm LIKE ? OR g.cuenta LIKE ? OR IFNULL(g.carnet,'') LIKE ? OR IFNULL(g.solicitud,'') LIKE ? OR IFNULL(g.reserva,'') LIKE ? OR UPPER(IFNULL(g.direccion,'')) LIKE ?)"
      );
      const like = `%${t}%`;
      args.push(like, like, like, like, like, like);
    }
  }
  if (p.get("desde")) { w.push("g.fecha_alta >= ?"); args.push(p.get("desde")); }
  if (p.get("hasta")) { w.push("g.fecha_alta <= ?"); args.push(p.get("hasta")); }
  if (p.get("plan")) { w.push("g.plan = ?"); args.push(p.get("plan")); }
  const pl = p.get("planilla"); // con | sin
  if (pl === "con") w.push("EXISTS (SELECT 1 FROM altas a WHERE a.cuenta=g.cuenta)");
  if (pl === "sin") w.push("NOT EXISTS (SELECT 1 FROM altas a WHERE a.cuenta=g.cuenta)");
  const where = w.length ? "WHERE " + w.join(" AND ") : "";
  const page = Math.max(1, +p.get("page") || 1);
  const size = Math.min(500, Math.max(1, +p.get("size") || 50));
  const sort = G_SORTS[p.get("sort")] || G_SORTS.fecha;
  const dir = p.get("dir") === "asc" ? "ASC" : "DESC";
  const total = await env.DB.prepare(`SELECT COUNT(*) n FROM genesis g ${where}`).bind(...args).first("n");
  const lim = p.get("all") === "1" ? "" : "LIMIT ? OFFSET ?";
  const { results } = await env.DB.prepare(
    `SELECT g.*, (SELECT a.hoja FROM altas a WHERE a.cuenta=g.cuenta) AS hoja_planilla,
       EXISTS (SELECT 1 FROM altas a WHERE a.cuenta=g.cuenta) AS en_planilla
     FROM genesis g ${where} ORDER BY ${sort} ${dir}, g.cuenta ${lim}`
  ).bind(...args, ...(lim ? [size, (page - 1) * size] : [])).all();
  return json({ total, page, size, rows: results });
}

async function genesisStats(env) {
  const [t, planes] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) n, MIN(fecha_alta) min, MAX(fecha_alta) max FROM genesis`).first(),
    env.DB.prepare(`SELECT plan, COUNT(*) n FROM genesis WHERE plan IS NOT NULL GROUP BY plan ORDER BY n DESC`).all(),
  ]);
  return json({ ...t, planes: planes.results });
}

// Clave de nombre independiente del orden de las palabras y de espacios dobles
const nameKey = (n) => norm(n).split(/\s+/).filter(Boolean).sort().join(" ");

/**
 * Compara planilla (altas) contra Genesis.
 * Estados: coincide | difiere | posible | solo_genesis | solo_planilla | fuera_rango
 *  - difiere: misma cuenta pero distinta fecha o nombre
 *  - posible: cuentas distintas pero mismo nombre (palabras en cualquier orden)
 *  - fuera_rango: solo existe en una fuente y su fecha cae fuera del periodo que cubre la otra
 */
async function comparar(env, url) {
  const p = url.searchParams;
  const [A, G] = await Promise.all([
    env.DB.prepare(`SELECT cuenta, fecha_instalacion f, nombre, hoja FROM altas`).all(),
    env.DB.prepare(`SELECT cuenta, fecha_alta f, nombre, carnet, plan, direccion FROM genesis`).all(),
  ]);
  const altas = A.results, gen = G.results;
  const range = (xs) => {
    const f = xs.map((x) => x.f).filter(Boolean).sort();
    return f.length ? { min: f[0], max: f.at(-1) } : null;
  };
  const rangoPlanilla = range(altas), rangoGenesis = range(gen);
  const inRange = (f, r) => !!(r && f && f >= r.min && f <= r.max);

  const gMap = new Map(gen.map((g) => [g.cuenta, g]));
  const aMap = new Map(altas.map((a) => [a.cuenta, a]));
  const out = [];
  const row = (estado, a, g, nota) => ({
    estado, nota: nota || null,
    cuenta: (a || g).cuenta, cuenta_genesis: g?.cuenta ?? null,
    fecha_planilla: a?.f ?? null, fecha_genesis: g?.f ?? null,
    nombre_planilla: a?.nombre ?? null, nombre_genesis: g?.nombre ?? null,
    hoja: a?.hoja ?? null, carnet: g?.carnet ?? null, plan: g?.plan ?? null, direccion: g?.direccion ?? null,
  });

  const soloA = [], soloG = [];
  for (const a of altas) {
    const g = gMap.get(a.cuenta);
    if (!g) { soloA.push(a); continue; }
    const notas = [];
    if (a.f && g.f && a.f !== g.f) notas.push(`fecha ${a.f} vs ${g.f}`);
    if (nameKey(a.nombre) !== nameKey(g.nombre)) notas.push("nombre distinto");
    out.push(row(notas.length ? "difiere" : "coincide", a, g, notas.join("; ")));
  }
  for (const g of gen) if (!aMap.has(g.cuenta)) soloG.push(g);

  // posibles: mismo nombre, distinta cuenta
  const byName = new Map();
  for (const g of soloG) { const k = nameKey(g.nombre); (byName.get(k) || byName.set(k, []).get(k)).push(g); }
  const usadosG = new Set();
  for (const a of soloA.slice()) {
    const cand = (byName.get(nameKey(a.nombre)) || []).find((g) => !usadosG.has(g.cuenta));
    if (cand) {
      usadosG.add(cand.cuenta);
      soloA.splice(soloA.indexOf(a), 1);
      out.push(row("posible", a, cand, "mismo nombre, cuenta distinta"));
    }
  }
  for (const a of soloA)
    out.push(row(inRange(a.f, rangoGenesis) ? "solo_planilla" : "fuera_rango", a, null,
      inRange(a.f, rangoGenesis) ? "no figura en Genesis" : "fecha fuera del periodo del Genesis cargado"));
  for (const g of soloG) {
    if (usadosG.has(g.cuenta)) continue;
    out.push(row(inRange(g.f, rangoPlanilla) ? "solo_genesis" : "fuera_rango", null, g,
      inRange(g.f, rangoPlanilla) ? "no figura en la planilla" : "fecha fuera del periodo de la planilla"));
  }

  const resumen = {};
  for (const r of out) resumen[r.estado] = (resumen[r.estado] || 0) + 1;

  // filtros
  const estado = p.get("estado");
  const q = norm(p.get("q") || "");
  const desde = p.get("desde"), hasta = p.get("hasta");
  let res = out.filter((r) => {
    if (estado && r.estado !== estado) return false;
    const f = r.fecha_genesis || r.fecha_planilla;
    if (desde && (!f || f < desde)) return false;
    if (hasta && (!f || f > hasta)) return false;
    if (q) {
      const hay = norm([r.cuenta, r.cuenta_genesis, r.nombre_planilla, r.nombre_genesis, r.carnet].join(" "));
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  const order = { solo_genesis: 0, solo_planilla: 1, posible: 2, difiere: 3, coincide: 4, fuera_rango: 5 };
  res.sort((x, y) => order[x.estado] - order[y.estado] ||
    String(y.fecha_genesis || y.fecha_planilla).localeCompare(String(x.fecha_genesis || x.fecha_planilla)));

  const all = p.get("all") === "1";
  const page = Math.max(1, +p.get("page") || 1);
  const size = Math.min(500, Math.max(1, +p.get("size") || 100));
  return json({
    resumen, rangoPlanilla, rangoGenesis, total: res.length, page, size,
    rows: all ? res : res.slice((page - 1) * size, page * size),
  });
}

async function stats(env) {
  const [tot, hojas, periodos] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) altas, (SELECT IFNULL(SUM(monto),0) FROM pagos) monto FROM altas`).first(),
    env.DB.prepare(`SELECT hoja, COUNT(*) n FROM altas GROUP BY hoja ORDER BY MIN(fecha_instalacion)`).all(),
    env.DB.prepare(`SELECT periodo, COUNT(*) n, SUM(monto) monto FROM pagos GROUP BY periodo ORDER BY periodo`).all(),
  ]);
  return json({ ...tot, hojas: hojas.results, periodos: periodos.results });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/altas" && req.method === "GET") return await listAltas(env, url);
      if (url.pathname === "/api/import" && req.method === "POST") return await importAltas(env, req);
      if (url.pathname === "/api/stats" && req.method === "GET") return await stats(env);
      if (url.pathname === "/api/genesis/import" && req.method === "POST") return await importGenesis(env, req);
      if (url.pathname === "/api/genesis" && req.method === "GET") return await listGenesis(env, url);
      if (url.pathname === "/api/genesis/stats" && req.method === "GET") return await genesisStats(env);
      if (url.pathname === "/api/comparar" && req.method === "GET") return await comparar(env, url);
      if (url.pathname.startsWith("/api/")) return json({ error: "no encontrado" }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};

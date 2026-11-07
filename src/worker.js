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
      if (url.pathname.startsWith("/api/")) return json({ error: "no encontrado" }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500);
    }
    return env.ASSETS.fetch(req);
  },
};

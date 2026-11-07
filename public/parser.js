// Parser de planillas de ventas (sin dependencias de DOM; recibe el objeto XLSX).
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const blank = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^\(en blanco\)$/i.test(s) || s === "-") return null;
  return s;
};

const mesIdx = (h) => {
  const s = String(h ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (s.includes("SEPT") || s.startsWith("SET")) return 8;
  const i = MESES.findIndex((m) => s.startsWith(m));
  return i; // -1 si no se reconoce
};

const iso = (d) => {
  if (!(d instanceof Date) || isNaN(d)) return null;
  // SheetJS entrega la fecha en hora local del navegador/proceso; usamos getters locales
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function splitContacts(a, b) {
  let email = null;
  const tels = [];
  for (const v of [blank(a), blank(b)]) {
    if (!v) continue;
    if (v.includes("@")) email = email || v.toLowerCase();
    else tels.push(v.replace(/\.0$/, ""));
  }
  return { email, telefono1: tels[0] || null, telefono2: tels[1] || null };
}

/** Devuelve { rows, resumen } a partir de un workbook leido con XLSX.read(..., {cellDates:true}) */
export function parseWorkbook(XLSX, wb, archivo) {
  const rows = [];
  const resumen = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const h = data.findIndex((r) => r.some((c) => String(c ?? "").trim().toUpperCase() === "CTA_CUENTA_DES"));
    if (h < 0) { resumen.push({ hoja: name, n: 0, nota: "sin encabezado" }); continue; }
    const body = data.slice(h + 1).filter((r) => /^\d{5,}$/.test(String(r[0] ?? "").trim()));
    if (!body.length) { resumen.push({ hoja: name, n: 0, nota: "vacia" }); continue; }

    // periodos de las columnas de cobro (indice 5 en adelante)
    const header = data[h];
    const firstDate = body.map((r) => r[1]).find((d) => d instanceof Date);
    let year = firstDate ? firstDate.getFullYear() : new Date().getFullYear();
    const periodos = {};
    let prev = -1;
    for (let c = 5; c < header.length; c++) {
      if (header[c] == null || String(header[c]).trim() === "") continue;
      let m = mesIdx(header[c]);
      if (m < 0) m = prev >= 0 ? (prev + 1) % 12 : -1; // tolera typos tipo "NIOVIEMBRE"
      if (m < 0) continue;
      if (prev >= 0 && m < prev) year++;
      prev = m;
      periodos[c] = `${year}-${String(m + 1).padStart(2, "0")}`;
    }

    for (const r of body) {
      const pagos = [];
      for (const [c, periodo] of Object.entries(periodos)) {
        const n = typeof r[c] === "number" ? r[c] : parseFloat(String(r[c] ?? "").replace(",", "."));
        if (isFinite(n) && n !== 0) pagos.push({ periodo, monto: n });
      }
      rows.push({
        cuenta: String(r[0]).trim(),
        fecha: iso(r[1]),
        nombre: blank(r[2]) || "(sin nombre)",
        ...splitContacts(r[3], r[4]),
        hoja: name,
        archivo,
        fuente: "planilla",
        pagos,
      });
    }
    resumen.push({ hoja: name, n: body.length });
  }
  return { rows, resumen };
}

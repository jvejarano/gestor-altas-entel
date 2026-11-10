// Parser del MHT guardado desde Genesis (https://genesis.entel.bo/altasRealizadas).
// Sin dependencias de DOM, para poder probarlo en Node.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(n);
    }
    return ENT[e.toLowerCase()] ?? m;
  });

const text = (cellHtml) =>
  decodeEntities(cellHtml.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function decodeQuotedPrintable(s) {
  const bytes = [];
  const clean = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "=" && /^[0-9A-F]{2}$/i.test(clean.substr(i + 1, 2))) {
      bytes.push(parseInt(clean.substr(i + 1, 2), 16));
      i += 2;
    } else bytes.push(...new TextEncoder().encode(c));
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

// "26-11-07" (aa-mm-dd) -> "2026-11-07"
function fechaGenesis(s) {
  const m = /^(\d{2,4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = m[1].length === 2 ? "20" + m[1] : m[1];
  return `${y}-${m[2]}-${m[3]}`;
}

/** @param {ArrayBuffer|string} input contenido del .mht */
export function parseGenesisMht(input, archivo = "Genesis.mht") {
  let raw = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
  const start = raw.search(/<!DOCTYPE html|<html/i);
  if (start < 0) throw new Error("El archivo no contiene HTML (¿es un .mht de Genesis?)");
  const headers = raw.slice(0, start);
  // cabecera de la parte HTML (la ultima antes del html)
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers.slice(headers.lastIndexOf("Content-Type: text/html")))) {
    raw = raw.slice(0, start) + decodeQuotedPrintable(raw.slice(start));
  }
  const m = /<table[^>]*custom-table[^>]*>[\s\S]*?<\/table>/i.exec(raw);
  if (!m) throw new Error("No se encontró la tabla de altas realizadas en el archivo");
  const table = m[0];

  const heads = [...table.matchAll(/<th[\s\S]*?<\/th>/gi)].map((x) => text(x[0]).toLowerCase());
  const col = (name) => heads.findIndex((h) => h.startsWith(name));
  const idx = {
    fecha: col("fecha"), carnet: col("carnet"), nombre: col("nombre"), cuenta: col("cuenta"),
    solicitud: col("solicitud"), reserva: col("reserva"), plan: col("plan"), dir: col("ref"),
  };
  if (idx.cuenta < 0 || idx.nombre < 0) throw new Error("Tabla sin columnas Cuenta/Nombre");

  const body = table.split(/<tbody/i)[1] || "";
  const rows = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const c = [...tr[1].matchAll(/<td[\s\S]*?<\/td>/gi)].map((x) => text(x[0]));
    const cuenta = (c[idx.cuenta] || "").trim();
    if (!/^\d{5,}$/.test(cuenta)) continue;
    rows.push({
      cuenta,
      fecha: fechaGenesis(c[idx.fecha] || ""),
      carnet: c[idx.carnet] || null,
      nombre: c[idx.nombre] || "(sin nombre)",
      solicitud: c[idx.solicitud] || null,
      reserva: c[idx.reserva] || null,
      plan: c[idx.plan] || null,
      direccion: c[idx.dir] || null,
      archivo,
    });
  }
  return rows;
}

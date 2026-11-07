# Gestor de Altas Entel

Cloudflare Worker + D1 (SQLite) + frontend estático. Sube planillas de ventas (.xlsx), las consolida por número de cuenta y permite búsqueda avanzada.

## Desarrollo local
```
npm install
npm run db:local
npm run dev        # http://localhost:8787
```

## Despliegue en Cloudflare
```
npx wrangler login
npx wrangler d1 create gestor-altas      # copiar database_id a wrangler.toml
npm run db:remote
npm run deploy
```
O conectar el repo de GitHub en Cloudflare (Workers & Pages > Create > Import repository) con build vacío y deploy command `npx wrangler deploy`.

**Importante:** la app contiene datos personales de clientes. Protégela con Cloudflare Access (Zero Trust) antes de usarla.

## Formato de planilla
Una hoja por mes: `CTA_CUENTA_DES, FECHA_INSTALACION, NOMBRE_COMPLETO, CL_MEDIO_CONTACTO, CL_MEDIO_CONTACTO_2` y luego columnas de cobro por mes. Re-subir actualiza (upsert por cuenta).

## Próximos pasos
- Importar "ventas cerradas" desde otra app / HTML / MHT (`altas.fuente` ya lo contempla).

# Convenciones del código

Reglas para que cualquier persona encuentre las cosas donde espera y el
sistema siga funcionando en producción.

## Dónde va cada cosa

| Si vas a… | Va en |
|-----------|-------|
| Agregar una tabla CRUD | Definición en `backend/src/modulos/tablas.js` + módulo en `backend/src/config/modulos.js` + vista en `frontend/js/nucleo/modulos.js` |
| Agregar una regla al guardar/borrar un registro | Un hook en `backend/src/modulos/<dominio>/<dominio>.hooks.js` |
| Agregar un endpoint que no es CRUD | `backend/src/modulos/<dominio>/<dominio>.rutas.js` y montarlo en `backend/src/rutas.js` |
| Lógica reutilizable con SQL | `<dominio>.servicio.js` |
| Un cálculo sin base de datos | `<dominio>.calculos.js`, con su test en `backend/test/` |
| Un PDF | `<dominio>.pdf.js` |
| Un valor fijo de negocio (alícuota, límites) | `backend/src/config/constantes.js` |
| Un servicio externo (AFIP/ARCA, correo…) | `backend/src/integraciones/` |
| Una vista nueva del sistema | `frontend/js/vistas/<vista>.js` + su `<script>` en `frontend/index.html` antes de `nucleo/sesion.js` |

## Nombres

- Identificadores, comentarios y carpetas **en español**, como el resto del código.
- Archivos en camelCase con sufijo por rol: `.rutas.js`, `.servicio.js`,
  `.hooks.js`, `.calculos.js`, `.pdf.js`, `.consultas.js`.
- Las tablas y columnas de MySQL **no se renombran** (hay datos en producción).
- Cada archivo empieza con un comentario con su ruta y qué hace.

## Reglas que protegen producción

1. **No cambiar las URLs de la API ni la forma del JSON** sin actualizar el
   frontend en el mismo cambio.
2. **`id_empresa` siempre lo pone el servidor** (`req.usuario.id_empresa`), nunca
   el cliente, y toda consulta filtra por él.
3. **Frontend:** las funciones siguen siendo globales (las usan los `onclick`).
   No renombrar una función sin buscar sus usos en los templates. Al cambiar un
   `.js` o `.css`, subir el `?v=` en `index.html`.
4. **Base de datos:** todo cambio de esquema es una migración nueva y numerada en
   `backend/database/migraciones/` y además se incorpora a `esquema/init_db.sql`.
   Nunca correr `init_db.sql` en producción.
5. **`server.js` de la raíz no se mueve**: lo usan PM2, systemd y las guías.
6. **`CERT_SECRET` no se cambia** una vez guardados certificados.

## Antes de subir un cambio

```bash
npm test
npm run verificar
# Con el servidor apuntando a una base de PRUEBA recién restaurada:
npm run smoke -- --guardar antes.json          # con la versión anterior
npm run smoke -- --comparar antes.json         # con la versión nueva
```

Un cambio que no debería alterar el comportamiento tiene que dar
"Sin diferencias".

## Formato

`.editorconfig` define UTF-8, fin de línea LF, 2 espacios de indentación.

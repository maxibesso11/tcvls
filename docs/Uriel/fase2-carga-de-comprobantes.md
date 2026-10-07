# Fase 2 · Carga de comprobantes de compra desde una foto

> Complemento del Bloque 7 (IVA discriminado en compras). Propuesta para la
> segunda entrega, junto con el Libro IVA Compras. No entra en la entrega del
> 5 de octubre.

## Para qué sirve

El Bloque 7 agrega a consumos y gastos los datos del comprobante del proveedor:
tipo, letra, número, fecha, neto, IVA, no gravado, exento, percepciones y total.
Cargarlos a mano es lento y es donde más errores aparecen. Con una foto del
ticket o factura, el sistema precarga el formulario y la persona solo revisa y
confirma.

Se propone en dos niveles, que se pueden entregar por separado:

| Nivel | Qué hace | Costo por uso | Precisión | Estimación (propia) |
|---|---|---|---|---|
| 1 · QR de ARCA + adjunto | Lee el QR de la RG 4892 y guarda la foto como respaldo | Ninguno | Exacta en los datos que trae el QR | 1–2 días |
| 2 · Extracción con IA | Lee la foto completa (neto, IVA, percepciones, litros…) | Por imagen procesada | Buena, con errores posibles: siempre se confirma | 2–3 días + pruebas con comprobantes reales |

**Depende de:** el Bloque 7 (las columnas donde se vuelcan los datos) y un
volumen de Docker para guardar las imágenes.

---

## Nivel 1 · Lectura del QR y comprobante adjunto

### Qué trae el QR

Toda factura electrónica argentina lleva desde 2021 el QR de la RG 4892/2020:
una URL `https://www.afip.gob.ar/fe/qr/?p=<base64>` cuyo parámetro `p` es un
JSON con:

| Campo del QR | Se vuelca en |
|---|---|
| `cuit` | Búsqueda de la cuenta del proveedor por `CUENTA.cuil` (si no existe, se ofrece crearla) |
| `tipoCmp` | `comprobante_tipo` y `comprobante_letra` (ver tabla de abajo) |
| `ptoVta`, `nroCmp` | `comprobante_punto_venta`, `comprobante_numero` |
| `fecha` | `fecha` |
| `importe` | Total del comprobante (se compara con `monto` o litros × precio) |
| `codAut`, `tipoCodAut` | CAE del proveedor (columna nueva opcional `comprobante_cae`) |

No trae neto ni IVA: esos los completa la persona, pero con el total ya fijado
la validación del Bloque 7 avisa si la suma no cierra.

Mapeo de `tipoCmp` (códigos de ARCA):

| Código | Tipo | Letra |
|---|---|---|
| 1 / 2 / 3 | Factura / Nota de débito / Nota de crédito | A |
| 6 / 7 / 8 | Factura / Nota de débito / Nota de crédito | B |
| 11 / 12 / 13 | Factura / Nota de débito / Nota de crédito | C |
| 51 / 52 / 53 | Factura / Nota de débito / Nota de crédito | M |

### Flujo

1. En el formulario de consumo o gasto, botón **"Cargar comprobante"** (en el
   celular abre la cámara: `<input type="file" accept="image/*,application/pdf" capture="environment">`).
2. El navegador reduce la imagen (canvas, lado mayor 1600 px, JPEG 80%) y busca
   el QR con una librería local (por ejemplo `jsQR`, copiada en
   `frontend/js/lib/`: la política de seguridad no permite scripts de otros
   dominios).
3. Si hay QR: se decodifica el JSON, se precargan los campos y se marcan como
   "leídos del QR". Si no hay QR: se avisa y se sigue con carga manual (o nivel 2).
4. Al guardar el gasto se sube la imagen como adjunto.

### Guardado de la imagen

- **Tabla `ADJUNTOS`**: `id_adjunto`, `id_empresa`, `origen_tipo`
  (`CONSUMO_COMBUSTIBLE`, `CONSUMO_GENERAL`, `GASTO_ADMINISTRATIVO`),
  `origen_id`, `nombre_original`, `tipo_mime`, `tamano_bytes`, `sha256`,
  `ruta`, `fecha_creacion`, `id_usuario`. Mismo criterio de origen que ya usa
  `MOVIMIENTOS`.
- **Archivos** en `/app/datos/adjuntos/<id_empresa>/<sha256>.<ext>`. El
  contenedor corre con `read_only: true`, así que hace falta un volumen nuevo
  en `docker-compose.yml` (`adjuntos:/app/datos/adjuntos`) y sumarlo a
  `deploy/servidor/respaldo-bd.sh`.
- **Endpoints** (módulo nuevo `backend/src/modulos/adjuntos/`):
  - `POST /api/adjuntos` — subida con su propio límite de tamaño (5 MB); el
    resto de la API sigue con el límite de 100 KB de `express.json`. Tipos
    permitidos: JPEG, PNG, PDF, verificados por contenido, no por extensión.
  - `GET /api/adjuntos/:id` — descarga, filtrando siempre por la empresa del
    token (otra empresa → 404).
  - `DELETE /api/adjuntos/:id` — solo si el gasto todavía no se cerró en un
    período contable (regla a definir con el contador).
- Al eliminar un consumo o gasto, su adjunto se da de baja en el mismo hook
  que ya elimina sus movimientos.

### Constatación con ARCA (opcional)

ARCA tiene un servicio de constatación de comprobantes que confirma si un CAE
existe y corresponde a ese CUIT, tipo, número, fecha e importe. Permitiría
marcar la factura del proveedor como **verificada**. Requiere autorizar ese
servicio al certificado de la empresa y depende del motor ARCA propio (ver el
análisis de Sistema-FACT, etapa 3).

---

## Nivel 2 · Extracción con IA

### Qué agrega

Un modelo con visión lee la foto completa y devuelve los datos que el QR no
trae: neto, alícuota, IVA, impuesto a los combustibles (va a `no_gravado`),
exento, percepciones, litros y precio por litro. Sirve también para tickets
manuales o de controlador fiscal que no tienen el QR.

### Diseño

- **Endpoint** `POST /api/adjuntos/:id/extraer` → devuelve una **sugerencia**,
  nunca guarda nada solo.
- **Salida estructurada** (JSON con esquema fijo): `cuit`, `razon_social`,
  `tipo`, `letra`, `punto_venta`, `numero`, `fecha`, `neto_gravado`,
  `alicuota`, `iva`, `no_gravado`, `exento`, `percepciones[]`, `total`,
  `litros`, `precio_litro` y un nivel de confianza por campo.
- **Prioridad de fuentes:** lo leído del QR gana siempre sobre la IA. Después,
  la validación del Bloque 7 (la suma tiene que cerrar con el total).
- **Pantalla:** los campos precargados por IA se resaltan y la persona confirma
  uno por uno los de baja confianza.
- **Configuración:** desactivado por defecto. Variables `IA_HABILITADA`,
  `IA_PROVEEDOR`, `IA_API_KEY` en el `.env`; se activa por empresa desde la
  administración global (como un módulo más).
- **Control de costos:** límite de extracciones por empresa y por mes, y una
  tabla `USO_IA` (empresa, fecha, adjunto, resultado) para facturarlo o
  auditarlo.

### Privacidad

Las imágenes salen del servidor hacia un servicio externo. Hay que:

- decírselo al cliente por escrito (contrato o términos de uso);
- usar un proveedor que no entrene con los datos enviados;
- guardar solo los campos extraídos, no la respuesta completa del modelo.

---

## Tests

- Unitarios: decodificación del QR con URLs reales de ejemplo; mapeo de
  `tipoCmp`; validación de tipo MIME por contenido; prioridad QR sobre IA.
- Integración: subir un adjunto y verlo solo desde su empresa (otra → 404);
  eliminar el gasto da de baja el adjunto; archivo de más de 5 MB o de tipo no
  permitido → rechazado; extracción con el proveedor de IA simulado.
- Aceptación: 20 a 30 comprobantes reales del cliente (combustible de distintas
  petroleras, repuestos, servicios, tickets sin QR), midiendo cuántos campos se
  precargan bien.

## Riesgos

- Fotos borrosas, arrugadas o con reflejo: el QR no se lee y la IA se equivoca
  más. Mitigación: guía de encuadre en pantalla y siempre confirmación humana.
- Volumen de imágenes: a 300–500 KB por foto reducida, mil comprobantes por
  mes son unos 0,5 GB. Entra en los respaldos, pero conviene medirlo.
- Costo de IA sin control: por eso el límite mensual por empresa.

## Decisiones pendientes

| # | Decisión | Quién |
|---|---|---|
| 1 | ¿El adjunto es obligatorio para comprobantes A (crédito fiscal)? | Contador |
| 2 | ¿Se cobra aparte la extracción con IA o va incluida en el abono? | Maxi |
| 3 | ¿Qué proveedor de IA y con qué condiciones de privacidad? | Tomás y Uriel |
| 4 | ¿Se habilita la constatación con ARCA desde el principio? | Contador |

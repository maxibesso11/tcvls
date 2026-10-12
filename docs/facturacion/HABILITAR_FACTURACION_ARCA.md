# Habilitar la facturación electrónica en ARCA

Guía para generar manualmente, con tu clave fiscal, las dos piezas que ARCA
te pide: el **certificado digital** (para que el sistema se autentique) y el
**punto de venta electrónico** (el número que va antes del guion en tus
comprobantes). Al terminar vas a tener tres datos/archivos para cargar en el
sistema: el certificado (.crt), la clave privada (.key) y el número de punto
de venta.

> Requisitos previos: CUIT activo, **clave fiscal nivel 3 o superior**, y estar
> inscripto como responsable inscripto (esto lo confirma tu contador). El
> portal es **www.arca.gob.ar** (antes AFIP). Con clave nivel 3, todo el
> proceso lleva alrededor de 20-30 minutos.

---

## PARTE A — Certificado digital

El certificado se genera en dos mitades: vos creás una **solicitud (CSR)** con
tu clave privada, ARCA la firma y te devuelve el **certificado (.crt)**.

### A.1 — Generar el CSR y la clave privada (en tu compu)

El CSR es un archivo de solicitud; la clave privada (.key) es tu secreto y
**no se comparte con nadie**. En una terminal con OpenSSL (Linux/Mac, o Git
Bash en Windows):

```bash
# 1. Generar la clave privada (guardala segura, la usa el sistema para facturar)
openssl genrsa -out clave_privada.key 2048

# 2. Generar la solicitud CSR con tus datos.
#    Reemplazá el CUIT (sin guiones) y el nombre de la empresa.
openssl req -new -key clave_privada.key -subj "/C=AR/O=TU EMPRESA SA/CN=tcv-logisuite/serialNumber=CUIT 30712345678" -out pedido.csr
```

Te quedan dos archivos: `pedido.csr` (se sube a ARCA) y `clave_privada.key`
(queda en tu poder, la necesita el sistema). No borres ninguno.

> Si no tenés OpenSSL a mano, muchos facturadores ofrecen un formulario web que
> genera el `.csr` y el `.key` en el navegador. Sirve igual: guardá los dos
> archivos.

### A.2 — Subir el CSR a ARCA y descargar el certificado

1. Entrá a **www.arca.gob.ar** → "Iniciar sesión", con tu CUIT y clave fiscal.
2. Buscá el servicio **"Administración de Certificados Digitales"**.
   - Si no aparece en tu lista de servicios, habilitalo primero desde el
     **"Administrador de Relaciones de Clave Fiscal"** (con la clave fiscal de
     la persona física, no de la sociedad) y aceptá la designación si hace falta.
3. Hacé clic en **"Agregar alias"**.
4. Poné un **alias** (un nombre corto para identificar el certificado, por
   ejemplo `tcv-logisuite`) y en **"Seleccionar archivo"** subí el
   `pedido.csr` del paso A.1.
5. Confirmá. ARCA procesa el CSR y genera el certificado.
6. Buscá el alias que creaste, hacé clic en **"Ver"** y luego en
   **"Descargar"** para obtener el archivo **`.crt`** (el certificado firmado
   por ARCA).
7. Guardá ese `.crt`. Si lo perdés, se vuelve a descargar del mismo panel sin
   regenerar nada.

Ahora tenés el `.crt` (certificado) y el `.key` (clave privada). Todavía falta
autorizarlo para facturar.

### A.3 — Asociar el certificado al web service de Factura Electrónica

Este es el paso que más se saltea, y sin él las facturas fallan con "Computador
no autorizado".

1. En ARCA, entrá al **"Administrador de Relaciones"**.
2. Hacé clic en **"Nueva relación"**.
3. En "Representado" dejá tu CUIT (o el de la empresa). En "Servicio" tocá
   **"Buscar"**.
4. Elegí: **ARCA → Webservices → "Facturación Electrónica"** (WSFEv1).
5. En **"Representante"** / **"Computador Fiscal"**, elegí del desplegable el
   **alias** que creaste en A.2 (`tcv-logisuite`). No completes el campo
   CUIT/CUIL de esa pantalla.
6. Confirmá. El certificado ya está autorizado a emitir facturas electrónicas.

---

## PARTE B — Punto de venta electrónico

Es un trámite **separado** del certificado. El punto de venta que uses para
web services debe ser **exclusivo** (no lo compartas con otro sistema, factura
en línea o controlador fiscal) para evitar rechazos por numeración duplicada.

1. En ARCA, entrá al servicio **"Administración de puntos de venta y
   domicilios"**.
2. Seleccioná la razón social con la que vas a facturar.
3. Entrá a **"ABM de puntos de venta"**. Vas a ver la lista de puntos de venta
   existentes.
   - Si alguno ya dice **"RECE para aplicativo y web services"** (para
     responsable inscripto), tomá nota de ese número y listo.
   - Si ninguno tiene esa descripción, hacé clic en **"Agregar"**.
4. Completá:
   - Un **número** de punto de venta nuevo (no continuo a los que ya usás; por
     ejemplo, si usás 0001 para talonario, elegí 0002 o 0003 para web services).
   - **Sistema**: elegí **"RECE para aplicativo y web services"** (esta es la
     opción para responsable inscripto que factura por web service). No elijas
     "Factura en línea", porque esa no sirve para el sistema.
   - **Domicilio** comercial asociado.
5. Guardá y **tomá nota del número** de punto de venta. Ese número es el que va
   a cargar la empresa en el sistema.

> Si al facturar aparece "No posee puntos de venta para operar" o el número no
> coincide, revisá que el punto de venta sea del tipo "web services" y que el
> número cargado en el sistema sea idéntico al de ARCA.

---

## PARTE C — Cargar todo en TCV LogiSuite

El sistema se conecta **directo** con ARCA (WSAA y WSFEv1) con el certificado
de cada empresa: la clave privada se guarda cifrada en la base y nunca sale
del servidor.

### C.1 — Datos fiscales

En **Mi empresa → Datos de la empresa** (rol administrador de la empresa):
condición frente al IVA, CUIT (11 dígitos), domicilio, ingresos brutos, inicio
de actividades y el **número de punto de venta** de la Parte B. La condición
frente al IVA define qué comprobantes se emiten:

| Empresa | Cliente | Comprobante |
|---------|---------|-------------|
| Responsable inscripto | Responsable inscripto o monotributista | **A** |
| Responsable inscripto | Consumidor final o exento | **B** |
| Monotributista o exento | cualquiera | **C** |

Un responsable inscripto nunca emite C y un monotributista nunca emite A ni B:
el sistema no deja elegir la letra.

### C.2 — Certificado

Dos caminos:

- **Desde el sistema (recomendado):** *Mi empresa → Certificado ARCA →
  Generar clave y CSR*. Se descarga el CSR, se tramita en ARCA (Parte A.2 y
  A.3) y se sube el `.crt` en la misma pantalla. No hace falta OpenSSL.
- **Con un `.crt` y `.key` que ya existen:** lo carga quien administra el
  servidor con `scripts/arca-importar-certificado.js` (ver
  `docs/operacion/SERVIDOR.md`). El script verifica que el certificado
  corresponda a la clave y al CUIT de la empresa.

> **Usá un certificado exclusivo para TCV LogiSuite.** ARCA entrega un "ticket
> de acceso" por certificado que dura 12 horas y **no entrega otro mientras
> ese siga vigente**. Si el mismo certificado lo usa otro sistema, el que
> llegue segundo queda bloqueado hasta 12 horas. El sistema guarda su ticket y
> lo reutiliza, así que con un certificado propio esto no pasa nunca.

### C.3 — Clientes

Cada cliente necesita su **condición frente al IVA** (en *Cuentas*; también se
puede indicar al facturar y queda guardada) y su **CUIT**. Un consumidor final
puede ir con DNI o sin identificar (solo en factura B).

### C.4 — Verificar antes de facturar

Quien administra el servidor corre el diagnóstico (no emite nada):

```bash
node scripts/arca-diagnostico.js --empresa <id>
```

Revisa los servidores de ARCA, el certificado, el ticket de acceso (si no hay
uno guardado avisa y pide repetir con `--pedir-acceso`), los puntos de venta
habilitados y el último número autorizado de cada tipo.

### C.5 — Homologación y producción

`ARCA_PRODUCCION=1` en el `.env` del servidor emite comprobantes reales; sin
esa variable se usa **homologación** (pruebas, sin validez fiscal: el PDF lo
dice). El certificado tiene que ser del mismo entorno: uno de homologación no
sirve en producción y viceversa. Validá con tu contador la condición
tributaria antes de emitir comprobantes reales.

---

## Cómo funciona el facturador

1. **Facturación → Nuevo comprobante** (o, desde un viaje, *Facturar → Armar
   factura electrónica*). Se elige el cliente y aparecen sus viajes
   finalizados que no están en otro comprobante.
2. Cada viaje elegido agrega un renglón (cantidad en toneladas, km o "1
   viaje"; precio = tarifa menos comisión, sin IVA en A y B). Todo se puede
   editar, quitar o agregar a mano. El texto de los renglones y de las
   observaciones sale de las **plantillas del cliente** (por ejemplo
   `CTG: {remitos} · KM: {km_total}` para Cargill), que se guardan para la
   próxima vez.
3. **Actividad:** si la empresa tiene más de una actividad inscripta en ARCA
   (por ejemplo, transporte de carga y servicios de logística), se elige por
   cuál se factura, igual que en el facturador web de ARCA. La lista la da
   ARCA (el diagnóstico la muestra en el paso 4b); con una sola, va esa sin
   preguntar. Se recuerda la última usada con cada cliente y la nota de
   crédito repite la de la factura.
4. **Guardar borrador** no usa número. **Emitir** pide el número y el CAE a
   ARCA. Si ARCA lo rechaza, vuelve a borrador con el motivo, sin gastar
   número.
5. Al emitir, el total se debita en la cuenta corriente del cliente y los
   viajes pasan a **FACTURADO**.
6. **Anular con nota de crédito** emite la nota por el total, compensa la
   cuenta y deja los viajes otra vez disponibles para facturar.
7. Si se corta la conexión al emitir, el comprobante queda **PENDIENTE** con
   su número reservado: *Verificar con ARCA* lo confirma (si ARCA lo autorizó)
   o lo devuelve a borrador. **No hay que volver a cargarlo.**

---

## Recordatorios que ahorran dolores de cabeza

- **El certificado vence a los 2 años.** Cuando vence, la facturación se corta
  sola hasta que generes uno nuevo. Anotá la fecha de vencimiento.
- **La clave privada (.key) es secreta.** No la subas a repositorios ni la
  compartas; si se filtra, hay que revocar el certificado.
- **Punto de venta exclusivo** para el sistema, distinto del de talonario,
  factura en línea o controlador fiscal: si otro sistema usa el mismo punto
  de venta, la numeración se cruza.
- Desde 2025 ARCA exige informar la **condición frente al IVA del receptor**:
  por eso el sistema la pide en cada cliente.

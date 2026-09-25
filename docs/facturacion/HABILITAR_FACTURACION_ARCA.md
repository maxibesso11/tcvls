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

Al terminar tenés tres cosas:

| Qué | Archivo / dato | De dónde salió |
|-----|----------------|----------------|
| Certificado | `certificado.crt` | Parte A.2 (descargado de ARCA) |
| Clave privada | `clave_privada.key` | Parte A.1 (lo generaste vos) |
| Punto de venta | número (ej. 3) | Parte B |

En el sistema:
1. En los **datos fiscales de la empresa** cargá el CUIT, ingresos brutos,
   inicio de actividades y el **número de punto de venta** de la Parte B.
2. El certificado (`.crt`) y la clave (`.key`) se cargan en la configuración de
   ARCA del servidor (variables de entorno / archivos del certificado). Esta
   parte requiere completar la integración técnica en `backend/src/integraciones/arca.js`, que hoy
   está preparada pero no conectada.

> **Importante:** primero conviene probar todo contra el **entorno de
> homologación** (prueba) de ARCA, que no genera comprobantes reales. Una vez
> que emite bien ahí, se pasa a **producción**. Y como no soy asesor fiscal,
> validá con tu contador tu condición tributaria y el tipo de comprobante antes
> de emitir comprobantes reales.

---

## Recordatorios que ahorran dolores de cabeza

- **El certificado vence a los 2 años.** Cuando vence, la facturación se corta
  sola hasta que generes uno nuevo. Anotá la fecha de vencimiento.
- **La clave privada (.key) es secreta.** No la subas a repositorios ni la
  compartas; si se filtra, hay que revocar el certificado.
- **Punto de venta exclusivo** para el sistema, distinto del de talonario o
  controlador fiscal.
- **Un cambio normativo reciente:** desde abril de 2026 es obligatorio informar
  la condición de IVA del receptor (campo `CondicionIVAReceptorId`) y la fecha
  y hora de generación del comprobante. La integración técnica del sistema debe
  contemplarlos.

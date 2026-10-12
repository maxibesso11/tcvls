-- =========================================================
-- TCV LogiSuite ERP — ESQUEMA COMPLETO (instalación limpia, SIN datos)
-- =========================================================
-- Crea todas las tablas y vistas con el esquema consolidado (incluye todas las
-- migraciones) y deja registradas las migraciones como aplicadas, para que
-- backend/database/migrar.js solo corra las que se agreguen después.
--
-- NO borra nada, NO crea la base y NO carga datos: se ejecuta sobre la base
-- vacía que indica DB_NAME. No se corre a mano: lo aplica
--   node backend/database/instalar.js
-- (en Docker: docker compose run --rm app node backend/database/instalar.js),
-- que además crea el administrador de plataforma. Los datos de ejemplo para
-- desarrollo y tests están aparte, en ../datos_prueba/datos_basicos.sql.
--
-- Al crear una migración nueva, incorporar el cambio acá y agregar su nombre a
-- la lista de MIGRACIONES del final.
--
-- Convenciones contables en MOVIMIENTOS:
--   monto > 0  = crédito a favor del titular (la empresa le adeuda)
--   monto < 0  = débito (el titular adeuda a la empresa)
--   - Consumos    → crédito al proveedor
--   - Facturación → débito al pagador (cliente)
--   - Liquidación → crédito al chofer
--   - Recibos     → compensan el saldo
-- =========================================================

-- =========================================================
-- TABLAS DE GESTIÓN MULTI-EMPRESA Y USUARIOS
-- =========================================================

-- EMPRESAS: cada firma de transporte. Sus datos están aislados.
CREATE TABLE EMPRESAS (
    id_empresa INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    iniciales VARCHAR(4),
    cuit VARCHAR(13) UNIQUE,
    domicilio VARCHAR(150),
    telefono VARCHAR(30),
    email VARCHAR(100),
    condicion_iva VARCHAR(40) DEFAULT 'RESPONSABLE INSCRIPTO',
    ingresos_brutos VARCHAR(20),
    inicio_actividades DATE,
    punto_venta INT DEFAULT 1,
    activa TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nombre (nombre)
);

-- USUARIOS: credenciales de acceso. El ADMIN gestiona empresas y usuarios
-- y no pertenece a ninguna empresa (id_empresa NULL). Los USUARIO operan
-- solo los datos de su empresa.
CREATE TABLE USUARIOS (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
    contrasena_hash VARCHAR(200) NOT NULL,
    correo VARCHAR(100),
    id_empresa INT,
    -- ADMIN: plataforma (todas las empresas). ADMIN_EMPRESA: opera su empresa
    -- como un USUARIO y además administra sus usuarios, certificado ARCA y
    -- datos fiscales (migración 028). ADMIN_MULTIEMPRESA: como ADMIN_EMPRESA
    -- pero para un subconjunto de empresas asignado por el ADMIN (tabla
    -- USUARIOS_EMPRESAS, migración 030); nunca crea ni da de baja empresas y,
    -- como el ADMIN, no pertenece a ninguna (id_empresa NULL): la empresa que
    -- está operando en cada momento viaja en la cabecera X-Empresa-Id, no en
    -- esta columna. USUARIO: solo opera su empresa.
    rol ENUM('ADMIN', 'ADMIN_EMPRESA', 'ADMIN_MULTIEMPRESA', 'USUARIO') NOT NULL DEFAULT 'USUARIO',
    tema VARCHAR(30) NOT NULL DEFAULT 'tcv',
    activo TINYINT(1) NOT NULL DEFAULT 1,
    -- Contraseña asignada por otro: debe cambiarse al ingresar (migración 024).
    debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0,
    -- Se incrementa al cambiar la contraseña e invalida las sesiones previas.
    version_sesion INT NOT NULL DEFAULT 0,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE SET NULL,
    INDEX idx_nombre_usuario (nombre_usuario),
    INDEX idx_empresa (id_empresa)
);

-- USUARIOS_EMPRESAS: empresas que un ADMIN_MULTIEMPRESA puede administrar y
-- operar. Solo la escribe el ADMIN global (migración 030).
CREATE TABLE USUARIOS_EMPRESAS (
    id_usuario INT NOT NULL,
    id_empresa INT NOT NULL,
    fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_usuario, id_empresa),
    FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario) ON DELETE CASCADE,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_ue_empresa (id_empresa)
);

-- MODULOS_EMPRESA: qué módulos del sistema tiene activos cada empresa.
-- Una fila por módulo activo. Desactivar un módulo NO borra sus datos:
-- solo lo oculta de la interfaz y bloquea su acceso. La clave del módulo
-- coincide con la ruta de la API (ej. 'viajes', 'consumos-combustible').
CREATE TABLE MODULOS_EMPRESA (
    id_empresa INT NOT NULL,
    modulo VARCHAR(40) NOT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (id_empresa, modulo),
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE
);

-- CERTIFICADOS_ARCA: material del certificado de facturación electrónica de
-- cada empresa. La clave privada se guarda CIFRADA (AES-256-GCM); nunca en
-- texto plano ni expuesta por la API. Una empresa tiene un certificado activo
-- por vez. El flujo de estados:
--   CSR_GENERADO → se generó la clave y el CSR, falta subir el .crt de ARCA
--   ACTIVO       → certificado cargado y vigente
--   VENCIDO      → pasó su fecha de vencimiento (hay que renovar)
CREATE TABLE CERTIFICADOS_ARCA (
    id_certificado INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    estado ENUM('CSR_GENERADO', 'ACTIVO', 'VENCIDO') NOT NULL DEFAULT 'CSR_GENERADO',
    alias VARCHAR(50),
    clave_privada_cifrada MEDIUMTEXT NOT NULL,
    csr_pem MEDIUMTEXT,
    certificado_pem MEDIUMTEXT,
    fecha_generacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_vencimiento DATE,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_cert_empresa (id_empresa)
);

-- =========================================================
-- ESQUEMA DE TABLAS
-- =========================================================

-- 1. CHOFERES
CREATE TABLE CHOFERES (
    id_chofer INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    cuil VARCHAR(13) NOT NULL,
    edad INT NOT NULL,
    ultima_jornada_descanso DATE,
    vencimiento_carnet DATE NOT NULL,
    domicilio VARCHAR(150) NOT NULL,
    telefono VARCHAR(15),
    -- remuneracion/tipo_remuneracion: solo de respaldo (migración 029, ver
    -- abajo); el backend usa las tres columnas siguientes.
    remuneracion DECIMAL(10, 2),
    tipo_remuneracion ENUM('POR KM', 'PORCENTAJE', 'FIJA'),
    -- Remuneración mixta: sueldo fijo mensual y/o variable por viaje, cada
    -- uno opcional. Un chofer puede tener las dos partes a la vez.
    sueldo_fijo_mensual DECIMAL(12, 2) NULL,
    variable_tipo ENUM('PORCENTAJE', 'POR KM') NULL,
    variable_valor DECIMAL(10, 2) NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_chofer_cuil (id_empresa, cuil),
    INDEX idx_vencimiento_carnet (vencimiento_carnet)
);

-- 2. UNIDADES
CREATE TABLE UNIDADES (
    id_unidad INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    patente VARCHAR(8) NOT NULL,
    modelo VARCHAR(100) NOT NULL,
    funcionalidad ENUM('PRINCIPAL', 'SECUNDARIA') NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_unidad_patente (id_empresa, patente),
    INDEX idx_funcionalidad (funcionalidad)
);

-- 3. EQUIPO
CREATE TABLE EQUIPO (
    id_equipo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_unidad_principal INT NOT NULL,
    id_unidad_secundaria INT NOT NULL,
    id_chofer INT NOT NULL,
    peso_tara DECIMAL(10,2),
    peso_bruto DECIMAL(10,2),
    -- Baja (migración 033): el equipo deja de operar; su historia se conserva.
    activo TINYINT(1) NOT NULL DEFAULT 1,
    fecha_baja DATETIME NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad_principal) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_unidad_secundaria) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    INDEX idx_chofer (id_chofer),
    INDEX idx_unidad_principal (id_unidad_principal),
    INDEX idx_unidad_secundaria (id_unidad_secundaria),
    INDEX idx_equipo_activo (id_empresa, activo)
);

-- 3b. EQUIPO_HISTORIAL: qué camión, acoplado y chofer tuvo cada equipo y
-- desde/hasta cuándo (desde NULL = desde el alta; hasta NULL = vigente).
-- Es la fuente de la "foto" de cada viaje y de la rentabilidad por equipo.
CREATE TABLE EQUIPO_HISTORIAL (
    id_historial INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_equipo INT NOT NULL,
    id_unidad_principal INT NOT NULL,
    id_unidad_secundaria INT NOT NULL,
    id_chofer INT NOT NULL,
    desde DATETIME NULL,
    hasta DATETIME NULL,
    id_usuario INT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad_principal) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_unidad_secundaria) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario) ON DELETE SET NULL,
    INDEX idx_historial_equipo (id_empresa, id_equipo, desde),
    INDEX idx_historial_principal (id_unidad_principal),
    INDEX idx_historial_secundaria (id_unidad_secundaria)
);

-- 4. VIAJES
CREATE TABLE VIAJES (
    id_viaje INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    fecha_origen DATETIME NOT NULL,
    tipo_carga VARCHAR(100) NOT NULL,
    origen VARCHAR(100) NOT NULL,
    destino VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    id_chofer INT,
    id_unidad_principal INT,
    id_unidad_secundaria INT,
    tarifa DECIMAL(10, 2) NOT NULL,
    tipo_tarifa ENUM('POR KM', 'POR TONELADA', 'UNICA') NOT NULL,
    cantidad_cargada DECIMAL(10, 2),
    resultado DECIMAL(10, 2),
    comision DECIMAL(5, 2) DEFAULT 0,
    estado ENUM('EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO') NOT NULL,
    modo_facturacion ENUM('SIN_FACTURAR', 'LIQUIDO_PRODUCTO', 'FACTURA') DEFAULT NULL,
    fecha_llegada DATETIME,
    pagador VARCHAR(100),
    numero_remito VARCHAR(20),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE RESTRICT,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE SET NULL,
    FOREIGN KEY (id_unidad_principal) REFERENCES UNIDADES(id_unidad) ON DELETE SET NULL,
    FOREIGN KEY (id_unidad_secundaria) REFERENCES UNIDADES(id_unidad) ON DELETE SET NULL,
    INDEX idx_equipo (id_equipo),
    INDEX idx_estado (estado),
    INDEX idx_fecha_origen (fecha_origen),
    INDEX idx_pagador (pagador),
    INDEX idx_numero_remito (numero_remito)
);
-- Nota: id_chofer es la "foto" del chofer que hizo el viaje, tomada del
-- equipo al momento de crear el viaje (o al cambiarle el equipo). La
-- liquidación al chofer usa esta foto, no el chofer actual del equipo,
-- para que las rotaciones de choferes no alteren viajes históricos.
-- id_unidad_principal / id_unidad_secundaria son la misma "foto" para el
-- camión y el acoplado: editar un equipo no reescribe sus viajes pasados.

-- 5. CONSUMOS COMBUSTIBLE
CREATE TABLE CONSUMOS_COMBUSTIBLE (
    id_consumo_combustible INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    estacion_carga VARCHAR(100) NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    id_equipo INT NOT NULL,
    cantidad_litros DECIMAL(8, 2) NOT NULL,
    km_recorridos DECIMAL(8, 2),
    precio_por_litro DECIMAL(8, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    -- Comprobante del proveedor (Bloque 7 · IVA en compras, migración 027).
    -- `cantidad_litros × precio_por_litro` sigue siendo el total al
    -- proveedor; estos campos solo lo discriminan en neto, IVA y el resto.
    comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
      NOT NULL DEFAULT 'NO_INFORMADO',
    comprobante_letra CHAR(1) NULL,
    comprobante_punto_venta INT NULL,
    comprobante_numero INT NULL,
    neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    iva_alicuota DECIMAL(5, 2) NULL,
    iva DECIMAL(12, 2) NOT NULL DEFAULT 0,
    no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    exento DECIMAL(12, 2) NOT NULL DEFAULT 0,
    percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_equipo) REFERENCES EQUIPO(id_equipo) ON DELETE RESTRICT,
    INDEX idx_equipo (id_equipo),
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- 6. CONSUMOS GENERALES
CREATE TABLE CONSUMOS_GENERALES (
    id_consumo_general INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    fecha DATETIME NOT NULL,
    id_unidad INT NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    -- Comprobante del proveedor (Bloque 7, migración 027): ver CONSUMOS_COMBUSTIBLE.
    comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
      NOT NULL DEFAULT 'NO_INFORMADO',
    comprobante_letra CHAR(1) NULL,
    comprobante_punto_venta INT NULL,
    comprobante_numero INT NULL,
    neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    iva_alicuota DECIMAL(5, 2) NULL,
    iva DECIMAL(12, 2) NOT NULL DEFAULT 0,
    no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    exento DECIMAL(12, 2) NOT NULL DEFAULT 0,
    percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- 7. CUENTA
CREATE TABLE CUENTA (
    id_cuenta INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    tipo ENUM('CHOFER', 'PROVEEDOR', 'CLIENTE') NOT NULL,
    cuil VARCHAR(13) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    domicilio VARCHAR(150),
    telefono VARCHAR(15),
    plazo_pago_dias INT DEFAULT NULL,
    -- Condición frente al IVA (Bloque 7, comparte con el Bloque 4): la
    -- necesita el futuro Libro IVA Compras. Puede quedar sin cargar.
    condicion_iva VARCHAR(40) NULL,
    -- Plantillas del facturador para este cliente (ver facturacion.plantillas.js).
    plantilla_item VARCHAR(255) NULL,
    plantilla_observaciones TEXT NULL,
    -- Última actividad de ARCA usada al facturarle (se propone la próxima vez).
    actividad_arca BIGINT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    UNIQUE KEY uq_cuenta_cuil (id_empresa, cuil),
    INDEX idx_tipo (tipo),
    INDEX idx_nombre (nombre)
);

-- FACTURAS: comprobantes emitidos (siempre Factura A en esta etapa).
-- Se crea después de VIAJES y CUENTA porque tiene claves foráneas a ambas.
-- Se asocia obligatoriamente a una CUENTA (el receptor) y opcionalmente a un
-- VIAJE. La numeración es correlativa por (empresa, punto de venta, tipo).
-- Los campos del receptor se guardan como "foto" al momento de emitir.
-- El CAE se completa cuando ARCA autoriza; hasta entonces queda en BORRADOR.
CREATE TABLE FACTURAS (
    id_factura INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    -- HOMOLOGACION (pruebas) o PRODUCCION: la numeración es independiente.
    entorno ENUM('HOMOLOGACION', 'PRODUCCION') NULL,
    clase ENUM('FACTURA', 'NOTA_CREDITO') NOT NULL DEFAULT 'FACTURA',
    tipo_comprobante CHAR(1) NOT NULL DEFAULT 'A',
    -- Código de ARCA: 1/6/11 facturas A/B/C; 3/8/13 notas de crédito A/B/C.
    codigo_arca SMALLINT NULL,
    punto_venta INT NOT NULL,
    -- Sin número mientras es BORRADOR; lo asigna ARCA al emitir.
    numero INT NULL,
    fecha_emision DATE NOT NULL,
    -- Concepto de ARCA: 2 = servicios (el flete), con período y vencimiento.
    concepto TINYINT NOT NULL DEFAULT 2,
    -- Actividad inscripta del emisor por la que se factura (ARCA, opcional).
    actividad_id BIGINT NULL,
    actividad_descripcion VARCHAR(255) NULL,
    fecha_servicio_desde DATE NULL,
    fecha_servicio_hasta DATE NULL,
    fecha_vto_pago DATE NULL,
    id_cuenta INT NOT NULL,
    id_viaje INT,
    id_factura_asociada INT,
    receptor_cuit VARCHAR(13) NOT NULL,
    receptor_doc_tipo SMALLINT NULL,
    receptor_nombre VARCHAR(150) NOT NULL,
    receptor_domicilio VARCHAR(150),
    receptor_condicion_iva VARCHAR(40) DEFAULT 'RESPONSABLE INSCRIPTO',
    condicion_iva_receptor_id SMALLINT NULL,
    emisor_condicion_iva VARCHAR(40) NULL,
    neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    iva DECIMAL(12, 2) NOT NULL DEFAULT 0,
    total DECIMAL(12, 2) NOT NULL DEFAULT 0,
    cae VARCHAR(20),
    cae_vencimiento DATE,
    -- BORRADOR → PENDIENTE (número reservado, esperando el CAE) → EMITIDA → ANULADA.
    estado ENUM('BORRADOR', 'PENDIENTE', 'EMITIDA', 'ANULADA') NOT NULL DEFAULT 'BORRADOR',
    respuesta_arca TEXT NULL,
    observaciones TEXT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_cuenta) REFERENCES CUENTA(id_cuenta) ON DELETE RESTRICT,
    FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE SET NULL,
    FOREIGN KEY (id_factura_asociada) REFERENCES FACTURAS(id_factura) ON DELETE SET NULL,
    UNIQUE KEY uq_factura_numero (id_empresa, entorno, tipo_comprobante, clase, punto_venta, numero),
    INDEX idx_fac_empresa (id_empresa),
    INDEX idx_fac_estado (id_empresa, estado),
    INDEX idx_fac_cuenta (id_cuenta),
    INDEX idx_fac_viaje (id_viaje),
    INDEX idx_fac_fecha (fecha_emision)
);

-- Renglones (ítems) de cada factura.
CREATE TABLE FACTURA_ITEMS (
    id_item INT AUTO_INCREMENT PRIMARY KEY,
    id_factura INT NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL DEFAULT 1,
    unidad VARCHAR(20),
    precio_unitario DECIMAL(12, 2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0,
    id_viaje INT NULL,
    FOREIGN KEY (id_factura) REFERENCES FACTURAS(id_factura) ON DELETE CASCADE,
    FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE SET NULL,
    INDEX idx_item_factura (id_factura)
);

-- Viajes que incluye cada comprobante (un comprobante puede tener varios).
CREATE TABLE FACTURA_VIAJES (
    id_factura INT NOT NULL,
    id_viaje INT NOT NULL,
    PRIMARY KEY (id_factura, id_viaje),
    FOREIGN KEY (id_factura) REFERENCES FACTURAS(id_factura) ON DELETE CASCADE,
    FOREIGN KEY (id_viaje) REFERENCES VIAJES(id_viaje) ON DELETE RESTRICT,
    INDEX idx_fv_viaje (id_viaje)
);

-- Tickets de acceso de ARCA (WSAA), cifrados: se reutilizan hasta que vencen.
CREATE TABLE ARCA_TICKETS (
    id_ticket INT AUTO_INCREMENT PRIMARY KEY,
    cuit VARCHAR(11) NOT NULL,
    entorno ENUM('HOMOLOGACION', 'PRODUCCION') NOT NULL,
    servicio VARCHAR(20) NOT NULL,
    huella_certificado CHAR(64) NOT NULL,
    token_cifrado MEDIUMTEXT NOT NULL,
    sign_cifrado MEDIUMTEXT NOT NULL,
    generado DATETIME NOT NULL,
    expira DATETIME NOT NULL,
    UNIQUE KEY uq_ticket (cuit, entorno, servicio, huella_certificado)
);

-- 8. MOVIMIENTOS
CREATE TABLE MOVIMIENTOS (
    id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_cuenta INT NOT NULL,
    monto DECIMAL(14, 2) NOT NULL,
    fecha DATETIME NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    -- Documento que generó el movimiento (NULL = cargado a mano). Ver migración 023.
    origen_tipo VARCHAR(30) NULL,
    origen_id INT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_cuenta) REFERENCES CUENTA(id_cuenta) ON DELETE RESTRICT,
    INDEX idx_mov_origen (id_empresa, origen_tipo, origen_id),
    INDEX idx_cuenta (id_cuenta),
    INDEX idx_fecha (fecha),
    INDEX idx_monto (monto)
);

-- 9. STOCK
CREATE TABLE STOCK (
    id_stock INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    elemento VARCHAR(150) NOT NULL,
    valuacion DECIMAL(10, 2) NOT NULL,
    deposito VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_elemento (elemento),
    INDEX idx_deposito (deposito)
);

-- 10. MANTENIMIENTOS
CREATE TABLE MANTENIMIENTOS (
    id_mantenimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_unidad INT NULL, -- NULL = mantenimiento general de la flota
    periodicidad VARCHAR(50) NOT NULL,
    fecha DATE,
    fecha_vencimiento DATE NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha_vencimiento (fecha_vencimiento),
    INDEX idx_concepto (concepto)
);

-- 11. VENCIMIENTOS
CREATE TABLE VENCIMIENTOS (
    id_vencimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    id_unidad INT NULL, -- NULL = vencimiento general de la flota (ej. un impuesto)
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_fecha_vencimiento (fecha_vencimiento),
    INDEX idx_concepto (concepto)
);

-- 12. CUBIERTAS
CREATE TABLE CUBIERTAS (
    id_cubierta INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    identificador VARCHAR(50),
    estado VARCHAR(50) NOT NULL,
    id_unidad INT NOT NULL,
    ubicacion ENUM('COLOCADA', 'AUXILIO') NOT NULL,
    fecha_colocacion DATE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_unidad) REFERENCES UNIDADES(id_unidad) ON DELETE RESTRICT,
    INDEX idx_unidad (id_unidad),
    INDEX idx_ubicacion (ubicacion),
    INDEX idx_estado (estado)
);

-- 13. GASTOS_ADMINISTRATIVOS
-- Gastos de estructura no asociados a una unidad ni a un viaje:
-- contabilidad, impuestos, asesorías, honorarios, seguros generales, etc.
CREATE TABLE GASTOS_ADMINISTRATIVOS (
    id_gasto_administrativo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    proveedor VARCHAR(100) NOT NULL,
    concepto VARCHAR(150) NOT NULL,
    fecha DATETIME NOT NULL,
    monto DECIMAL(10, 2) NOT NULL,
    -- Comprobante del proveedor (Bloque 7, migración 027): ver CONSUMOS_COMBUSTIBLE.
    comprobante_tipo ENUM('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'TICKET', 'RECIBO', 'SIN_COMPROBANTE', 'NO_INFORMADO')
      NOT NULL DEFAULT 'NO_INFORMADO',
    comprobante_letra CHAR(1) NULL,
    comprobante_punto_venta INT NULL,
    comprobante_numero INT NULL,
    neto_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    iva_alicuota DECIMAL(5, 2) NULL,
    iva DECIMAL(12, 2) NOT NULL DEFAULT 0,
    no_gravado DECIMAL(12, 2) NOT NULL DEFAULT 0,
    exento DECIMAL(12, 2) NOT NULL DEFAULT 0,
    percepciones DECIMAL(12, 2) NOT NULL DEFAULT 0,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    INDEX idx_fecha (fecha),
    INDEX idx_proveedor (proveedor)
);

-- 14. LIQUIDACIONES_SUELDO: sueldo fijo liquidado por chofer y período
-- (AAAA-MM), para que la acción "Liquidar sueldos fijos del mes" no duplique
-- el movimiento si se corre más de una vez (migración 029).
CREATE TABLE LIQUIDACIONES_SUELDO (
    id_liquidacion_sueldo INT AUTO_INCREMENT PRIMARY KEY,
    id_empresa INT NOT NULL,
    id_chofer INT NOT NULL,
    periodo CHAR(7) NOT NULL COMMENT 'AAAA-MM',
    monto DECIMAL(12, 2) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_empresa) REFERENCES EMPRESAS(id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_chofer) REFERENCES CHOFERES(id_chofer) ON DELETE RESTRICT,
    UNIQUE KEY uq_liquidacion_sueldo_periodo (id_empresa, id_chofer, periodo)
);

-- 15. AUDITORIA: bitácora de actividad (ingresos, altas, cambios y bajas).
-- Sin claves foráneas: el historial sobrevive a la baja de usuarios y empresas (migración 032).
CREATE TABLE AUDITORIA (
    id_auditoria BIGINT AUTO_INCREMENT PRIMARY KEY,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_usuario INT NULL,
    nombre_usuario VARCHAR(100) NULL,
    rol VARCHAR(30) NULL,
    id_empresa INT NULL,
    ip VARCHAR(45) NULL,
    accion VARCHAR(40) NOT NULL,
    entidad VARCHAR(60) NULL,
    id_entidad VARCHAR(40) NULL,
    metodo VARCHAR(8) NOT NULL,
    ruta VARCHAR(255) NOT NULL,
    estado ENUM('OK', 'ERROR') NOT NULL,
    codigo_http SMALLINT NOT NULL,
    detalle VARCHAR(255) NULL,
    navegador VARCHAR(255) NULL,
    INDEX idx_aud_fecha (fecha),
    INDEX idx_aud_empresa_fecha (id_empresa, fecha),
    INDEX idx_aud_usuario (id_usuario),
    INDEX idx_aud_accion (accion)
);

-- V_COMPRAS_FISCALES: une los tres registros de compra con el CUIT y la
-- condición de IVA del proveedor, lista para el Libro IVA Compras (Bloque 7,
-- 2da entrega).
CREATE OR REPLACE VIEW V_COMPRAS_FISCALES AS
  SELECT 'CONSUMOS_COMBUSTIBLE' AS origen_tabla, cc.id_consumo_combustible AS origen_id,
         cc.id_empresa, cc.proveedor, c.cuil AS proveedor_cuil, c.condicion_iva AS proveedor_condicion_iva,
         cc.fecha, cc.comprobante_tipo, cc.comprobante_letra, cc.comprobante_punto_venta, cc.comprobante_numero,
         cc.neto_gravado, cc.iva_alicuota, cc.iva, cc.no_gravado, cc.exento, cc.percepciones,
         ROUND(cc.cantidad_litros * cc.precio_por_litro, 2) AS total
    FROM CONSUMOS_COMBUSTIBLE cc
    LEFT JOIN CUENTA c ON c.id_empresa = cc.id_empresa AND c.nombre = cc.proveedor AND c.tipo = 'PROVEEDOR'
  UNION ALL
  SELECT 'CONSUMOS_GENERALES', cg.id_consumo_general,
         cg.id_empresa, cg.proveedor, c.cuil, c.condicion_iva,
         cg.fecha, cg.comprobante_tipo, cg.comprobante_letra, cg.comprobante_punto_venta, cg.comprobante_numero,
         cg.neto_gravado, cg.iva_alicuota, cg.iva, cg.no_gravado, cg.exento, cg.percepciones,
         cg.monto
    FROM CONSUMOS_GENERALES cg
    LEFT JOIN CUENTA c ON c.id_empresa = cg.id_empresa AND c.nombre = cg.proveedor AND c.tipo = 'PROVEEDOR'
  UNION ALL
  SELECT 'GASTOS_ADMINISTRATIVOS', ga.id_gasto_administrativo,
         ga.id_empresa, ga.proveedor, c.cuil, c.condicion_iva,
         ga.fecha, ga.comprobante_tipo, ga.comprobante_letra, ga.comprobante_punto_venta, ga.comprobante_numero,
         ga.neto_gravado, ga.iva_alicuota, ga.iva, ga.no_gravado, ga.exento, ga.percepciones,
         ga.monto
    FROM GASTOS_ADMINISTRATIVOS ga
    LEFT JOIN CUENTA c ON c.id_empresa = ga.id_empresa AND c.nombre = ga.proveedor AND c.tipo = 'PROVEEDOR';

-- =========================================================
-- REGISTRO DE MIGRACIONES
-- Este esquema ya incluye todas las migraciones: se registran como aplicadas
-- para que backend/database/migrar.js solo corra las que se agreguen después.
-- Al crear una migración nueva, agregarla también a esta lista.
-- =========================================================
CREATE TABLE MIGRACIONES (
    nombre VARCHAR(100) NOT NULL PRIMARY KEY,
    aplicada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO MIGRACIONES (nombre) VALUES
('migracion_001_numero_remito.sql'),
('migracion_002_sincronizar_choferes.sql'),
('migracion_003_movimientos_consumos.sql'),
('migracion_004_remuneracion_choferes.sql'),
('migracion_005_movimientos_viajes.sql'),
('migracion_006_liquidacion_choferes.sql'),
('migracion_007_cubiertas_identificador.sql'),
('migracion_008_eliminar_campos_pago_viajes.sql'),
('migracion_009_ampliar_concepto_movimientos.sql'),
('migracion_010_comision_viajes.sql'),
('migracion_011_gastos_administrativos.sql'),
('migracion_012_multiempresa_usuarios.sql'),
('migracion_013_tema_usuario.sql'),
('migracion_014_iniciales_empresa.sql'),
('migracion_015_pesos_equipo.sql'),
('migracion_016_modulos_empresa.sql'),
('migracion_017_facturacion.sql'),
('migracion_018_chofer_viaje.sql'),
('migracion_019_plazo_pago_cuenta.sql'),
('migracion_020_modo_facturacion_viaje.sql'),
('migracion_021_certificados_arca.sql'),
('migracion_022_facturacion_requisito_viajes.sql'),
('migracion_023_origen_movimientos.sql'),
('migracion_024_seguridad_usuarios.sql'),
('migracion_025_unidades_viaje.sql'),
('migracion_026_historial_equipos.sql'),
('migracion_027_iva_compras.sql'),
('migracion_028_rol_admin_empresa.sql'),
('migracion_029_remuneracion_mixta.sql'),
('migracion_030_rol_admin_multiempresa.sql'),
('migracion_031_vencimientos_mantenimientos_generales.sql'),
('migracion_032_auditoria.sql'),
('migracion_033_baja_equipos.sql'),
('migracion_034_facturacion_electronica.sql'),
('migracion_035_tema_marca.sql'),
('migracion_036_conceptos_sin_separadores.sql'),
('migracion_037_actividad_comprobante.sql');

-- =========================================================
-- FIN DE LA INSTALACIÓN
-- =========================================================

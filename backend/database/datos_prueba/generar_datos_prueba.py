#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador de datos de prueba a gran escala para TCV LogiSuite ERP.

Produce un script SQL con un volumen configurable de datos sintéticos
coherentes, que respetan TODAS las reglas de negocio del sistema:
  - Las cuentas (CLIENTE/PROVEEDOR/CHOFER) existen antes de ser usadas.
  - Cada chofer tiene su cuenta CHOFER (igual que crea el hook).
  - Los consumos y gastos generan su movimiento de crédito al proveedor.
  - Los viajes FINALIZADO/FACTURADO generan liquidación al chofer, y los
    FACTURADO además generan la facturación (base - comisión, +IVA 21%) al
    pagador, replicando exactamente lo que hacen los hooks del backend.
  - Patentes y CUIT únicos por empresa.

Uso:
    python3 generar_datos_prueba.py --factor 50 > datos_prueba_masivos.sql
    # factor 50 ≈ 50x el volumen de los datos de ejemplo originales

Luego cargar en una base ya creada con el esquema:
    mysql -u erp_user -p erp_3_abril < datos_prueba_masivos.sql
"""
import argparse
import random
from datetime import datetime, timedelta

random.seed(42)  # reproducible

IVA = 0.21

# --------- Vocabulario para datos realistas ---------
NOMBRES = ['Juan', 'Carlos', 'Miguel', 'Roberto', 'Luis', 'Jorge', 'Diego', 'Pablo',
           'Sergio', 'Marcos', 'Andrés', 'Fernando', 'Raúl', 'Gustavo', 'Héctor',
           'Daniel', 'Alberto', 'Ricardo', 'Oscar', 'Eduardo', 'Martín', 'Hugo']
APELLIDOS = ['Pérez', 'Gómez', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'García',
             'Sánchez', 'Romero', 'Torres', 'Ruiz', 'Díaz', 'Acosta', 'Molina',
             'Suárez', 'Herrera', 'Medina', 'Rojas', 'Castro', 'Ortiz', 'Núñez', 'Silva']
CIUDADES = ['Córdoba', 'Rosario', 'Santa Fe', 'Mendoza', 'Buenos Aires', 'Tucumán',
            'Salta', 'Río Cuarto', 'Villa María', 'San Luis', 'Paraná', 'Resistencia',
            'Bahía Blanca', 'Mar del Plata', 'Junín', 'Pergamino', 'Rafaela', 'Venado Tuerto']
CARGAS = ['Soja', 'Maíz', 'Trigo', 'Girasol', 'Sorgo', 'Cebada', 'Cemento', 'Áridos',
          'Combustible', 'Hacienda', 'Contenedor', 'Maquinaria', 'Fertilizante']
MODELOS_TRACTOR = ['Scania R450', 'Volvo FH 460', 'Mercedes Actros 2545', 'Iveco Stralis 480',
                   'Ford Cargo 1933', 'VW Constellation 25.420', 'DAF XF 480']
MODELOS_ACOPL = ['Acoplado Helvética', 'Semi Randon', 'Batea Hermann', 'Semi Montenegro',
                 'Acoplado Salto', 'Batea Ombú', 'Semi Sola y Brusa']
ESTACIONES = ['YPF', 'Shell', 'Axion', 'Puma', 'Gulf', 'Refinor']
PROV_GENERALES = ['Repuestos del Centro', 'Gomería La Rueda', 'Taller Hnos. López',
                  'Lubricentro Sur', 'Electromecánica Díaz', 'Repuestos Camino']
PROV_ADMIN = ['Estudio Contable Ruiz', 'AFIP', 'Rentas Córdoba', 'Consultora Vial SRL',
              'Seguros La Meridional', 'Sindicato Camioneros', 'Escribanía Central']
CONCEPTOS_GEN = ['Cambio de aceite y filtros', 'Reparación de frenos', 'Juego de cubiertas',
                 'Service de motor', 'Cambio de embrague', 'Alineación y balanceo',
                 'Reparación eléctrica', 'Cambio de correa', 'Service de caja']
CONCEPTOS_ADMIN = ['Honorarios contables mensuales', 'Pago de IVA mensual',
                   'Impuesto a los Ingresos Brutos', 'Asesoría legal',
                   'Aportes y contribuciones', 'Seguro de flota', 'Cuota sindical']
ELEMENTOS_STOCK = ['Cubierta 295/80 R22.5', 'Filtro de aceite', 'Filtro de aire',
                   'Pastillas de freno', 'Batería 12V 180Ah', 'Bomba de agua',
                   'Kit de embrague', 'Correa de distribución', 'Faro delantero',
                   'Espejo retrovisor', 'Lona cubre carga', 'Cadena de seguridad']
CONCEPTOS_MANT = ['Service general', 'Cambio de aceite', 'Revisión de frenos',
                  'Engrase general', 'Cambio de filtros']
CONCEPTOS_VENC = ['VTV', 'Seguro obligatorio', 'RUTA (habilitación)', 'Ruta nacional',
                  'Senasa', 'Matafuegos']


def fecha_aleatoria(dias_atras_max=365):
    """Fecha en los últimos N días."""
    d = datetime.now() - timedelta(days=random.randint(0, dias_atras_max),
                                   hours=random.randint(0, 23),
                                   minutes=random.randint(0, 59))
    return d.strftime('%Y-%m-%d %H:%M:%S')


def fecha_futura_o_pasada(dias_rango=180):
    d = datetime.now() + timedelta(days=random.randint(-dias_rango, dias_rango))
    return d.strftime('%Y-%m-%d')


def patente():
    letras = lambda n: ''.join(random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ') for _ in range(n))
    return f"{letras(2)}{random.randint(100,999)}{letras(2)}"


def cuil(prefijo='20'):
    return f"{prefijo}-{random.randint(10000000, 45000000)}-{random.randint(0,9)}"


def esc(s):
    return str(s).replace("'", "''")


class Generador:
    def __init__(self, factor, id_empresa=1):
        self.factor = factor
        self.emp = id_empresa
        self.sql = []
        # IDs autoincrementales simulados (continúan después de los datos base)
        # Asumimos base recién instalada; estos datos se cargan APARTE, por lo
        # que usamos rangos altos para no chocar con los de ejemplo.
        self.lineas_por_tabla = {}

    def add(self, texto):
        self.sql.append(texto)

    def generar(self):
        cab = (f"-- Datos de prueba masivos (factor x{self.factor}) para empresa {self.emp}\n"
               f"-- Generado automáticamente. Cargar sobre el esquema ya creado.\n"
               f"SET @emp := {self.emp};\n"
               f"START TRANSACTION;\n")
        self.add(cab)

        choferes = self._choferes()
        unidades_p, unidades_s = self._unidades()
        equipos = self._equipos(unidades_p, unidades_s, choferes)
        clientes = self._cuentas_clientes()
        prov_comb = self._cuentas_proveedores(ESTACIONES, 'comb')
        prov_gen = self._cuentas_proveedores(PROV_GENERALES, 'gen')
        prov_adm = self._cuentas_proveedores(PROV_ADMIN, 'adm')
        self._cuentas_choferes(choferes)

        self._viajes(equipos, choferes, clientes)
        self._consumos_combustible(equipos, prov_comb)
        self._consumos_generales(unidades_p + unidades_s, prov_gen)
        self._gastos_admin(prov_adm)
        self._stock()
        self._mantenimientos(unidades_p + unidades_s)
        self._vencimientos(unidades_p + unidades_s)
        self._cubiertas(unidades_p + unidades_s)

        self.add("COMMIT;")
        return '\n'.join(self.sql)

    # ---- Generadores por tabla (devuelven listas de dicts con sus datos) ----

    def _choferes(self):
        n = 5 * self.factor
        filas = []
        valores = []
        for i in range(n):
            nombre = f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)}"
            c = cuil('20')
            tipo = random.choice(['POR KM', 'PORCENTAJE', 'FIJA'])
            remu = {'POR KM': round(random.uniform(120, 260), 2),
                    'PORCENTAJE': round(random.uniform(8, 18), 2),
                    'FIJA': round(random.uniform(600000, 1200000), 2)}[tipo]
            ch = {'nombre': nombre, 'cuil': c, 'tipo': tipo, 'remu': remu}
            filas.append(ch)
            valores.append(
                f"(@emp, '{esc(nombre)}', '{c}', {random.randint(25,62)}, "
                f"'{fecha_futura_o_pasada(30)}', '{fecha_futura_o_pasada(400)}', "
                f"'{esc(random.choice(CIUDADES))} {random.randint(100,9999)}', "
                f"'{random.randint(300,388)}-{random.randint(1000000,9999999)}', "
                f"{remu}, '{tipo}')"
            )
        self._insert('CHOFERES',
                     'id_empresa, nombre, cuil, edad, ultima_jornada_descanso, vencimiento_carnet, domicilio, telefono, remuneracion, tipo_remuneracion',
                     valores)
        # Guardar variables para enlazar por @ no es práctico; usamos subconsultas por cuil.
        return filas

    def _unidades(self):
        n_equipos = 5 * self.factor
        principales, secundarias = [], []
        valores = []
        for i in range(n_equipos):
            pp = patente()
            principales.append(pp)
            valores.append(f"(@emp, '{pp}', '{esc(random.choice(MODELOS_TRACTOR))}', 'PRINCIPAL')")
            ps = patente()
            secundarias.append(ps)
            valores.append(f"(@emp, '{ps}', '{esc(random.choice(MODELOS_ACOPL))}', 'SECUNDARIA')")
        self._insert('UNIDADES', 'id_empresa, patente, modelo, funcionalidad', valores)
        return principales, secundarias

    def _equipos(self, principales, secundarias, choferes):
        valores = []
        equipos = []
        for i in range(len(principales)):
            ch = choferes[i]
            equipos.append({'pp': principales[i], 'ps': secundarias[i], 'chofer': ch})
            tara = random.randint(13000, 16000)
            bruto = random.choice([43000, 44000, 45000, 46000])
            valores.append(
                f"(@emp, "
                f"(SELECT id_unidad FROM UNIDADES WHERE patente='{principales[i]}' AND id_empresa=@emp), "
                f"(SELECT id_unidad FROM UNIDADES WHERE patente='{secundarias[i]}' AND id_empresa=@emp), "
                f"(SELECT id_chofer FROM CHOFERES WHERE cuil='{ch['cuil']}' AND id_empresa=@emp), "
                f"{tara}.00, {bruto}.00)"
            )
        self._insert('EQUIPO', 'id_empresa, id_unidad_principal, id_unidad_secundaria, id_chofer, peso_tara, peso_bruto', valores)
        return equipos

    def _cuentas_clientes(self):
        n = 8 * self.factor
        nombres = []
        valores = []
        usados = set()
        for i in range(n):
            nombre = f"{random.choice(['Agro','Cerealera','Transporte','Comercial','Logística','Cooperativa'])} {random.choice(APELLIDOS)} {random.choice(['SA','SRL','SAS','y Cía'])}"
            if nombre in usados:
                nombre += f" {i}"
            usados.add(nombre)
            nombres.append(nombre)
            valores.append(
                f"(@emp, 'CLIENTE', '{cuil('30')}', '{esc(nombre)}', "
                f"'{esc(random.choice(CIUDADES))} {random.randint(100,9999)}', "
                f"'{random.randint(300,388)}-{random.randint(1000000,9999999)}')"
            )
        self._insert('CUENTA', 'id_empresa, tipo, cuil, nombre, domicilio, telefono', valores)
        return nombres

    def _cuentas_proveedores(self, base_nombres, sufijo):
        # Multiplicamos los proveedores base según el factor (pero con tope razonable)
        n = max(len(base_nombres), min(len(base_nombres) * self.factor, len(base_nombres) * 6))
        nombres = []
        valores = []
        usados = set()
        for i in range(n):
            base = base_nombres[i % len(base_nombres)]
            nombre = base if base not in usados else f"{base} {i//len(base_nombres)+1}"
            usados.add(nombre)
            nombres.append(nombre)
            valores.append(
                f"(@emp, 'PROVEEDOR', '{cuil('30')}', '{esc(nombre)}', "
                f"'{esc(random.choice(CIUDADES))} {random.randint(100,9999)}', "
                f"'{random.randint(300,388)}-{random.randint(1000000,9999999)}')"
            )
        self._insert('CUENTA', 'id_empresa, tipo, cuil, nombre, domicilio, telefono', valores)
        return nombres

    def _cuentas_choferes(self, choferes):
        # Igual que el hook: cada chofer tiene su cuenta CHOFER (mismo cuil)
        valores = []
        for ch in choferes:
            valores.append(
                f"(@emp, 'CHOFER', '{ch['cuil']}', '{esc(ch['nombre'])}', "
                f"'{esc(random.choice(CIUDADES))} {random.randint(100,9999)}', "
                f"'{random.randint(300,388)}-{random.randint(1000000,9999999)}')"
            )
        self._insert('CUENTA', 'id_empresa, tipo, cuil, nombre, domicilio, telefono', valores)

    def _viajes(self, equipos, choferes, clientes):
        n = 9 * self.factor
        valores = []
        movimientos = []
        remito = 1000
        for i in range(n):
            eq = random.choice(equipos)
            ch = eq['chofer']
            tipo_tarifa = random.choice(['POR KM', 'POR TONELADA', 'UNICA'])
            estado = random.choices(['EN CURSO', 'EN DESTINO', 'FINALIZADO', 'FACTURADO'],
                                    weights=[10, 10, 25, 55])[0]
            origen = random.choice(CIUDADES)
            destino = random.choice([c for c in CIUDADES if c != origen])
            tarifa = round(random.uniform(1500, 4500), 2) if tipo_tarifa != 'UNICA' else round(random.uniform(800000, 2500000), 2)
            cantidad = round(random.uniform(25, 40), 2)
            tiene_resultado = estado in ('FINALIZADO', 'FACTURADO')
            resultado = round(cantidad + random.uniform(-3, 3), 2) if tiene_resultado and tipo_tarifa != 'UNICA' else ('NULL' if not tiene_resultado else cantidad)
            comision = random.choice([0, 0, 0, 5, 8, 10])
            pagador = random.choice(clientes)
            f_origen = fecha_aleatoria(365)
            f_llegada = 'NULL' if estado == 'EN CURSO' else f"'{f_origen}'"
            res_sql = 'NULL' if resultado == 'NULL' else str(resultado)
            num_remito = f"R-{remito+i:06d}"

            valores.append(
                f"(@emp, '{f_origen}', '{esc(random.choice(CARGAS))}', '{esc(origen)}', '{esc(destino)}', "
                f"(SELECT id_equipo FROM EQUIPO e JOIN UNIDADES u ON u.id_unidad=e.id_unidad_principal "
                f"WHERE u.patente='{eq['pp']}' AND e.id_empresa=@emp LIMIT 1), "
                f"{tarifa}, '{tipo_tarifa}', {cantidad}, {res_sql}, {comision}, '{estado}', "
                f"{f_llegada}, '{esc(pagador)}', '{num_remito}')"
            )

            # --- Replicar la lógica de los hooks para los movimientos ---
            base = tarifa if tipo_tarifa == 'UNICA' else tarifa * (resultado if resultado != 'NULL' else cantidad)
            # Liquidación al chofer (FINALIZADO o FACTURADO)
            if estado in ('FINALIZADO', 'FACTURADO'):
                if ch['tipo'] == 'PORCENTAJE':
                    liq = base * ch['remu'] / 100
                elif ch['tipo'] == 'POR KM' and tipo_tarifa == 'POR KM':
                    liq = (resultado if resultado != 'NULL' else 0) * ch['remu']
                else:
                    liq = 0
                if liq > 0:
                    movimientos.append(
                        (ch['cuil'], 'CHOFER', round(liq, 2), f_origen,
                         f"LIQUIDACION VIAJE #masivo-{i} — {origen} → {destino}")
                    )
            # Facturación al pagador (FACTURADO)
            if estado == 'FACTURADO':
                neto = base * (1 - comision / 100)
                total = neto * (1 + IVA)
                detalle = f"[comisión {comision}% + IVA 21%]" if comision > 0 else "[IVA 21%]"
                movimientos.append(
                    (None, 'CLIENTE_NOMBRE:' + pagador, -round(total, 2), f_origen,
                     f"FACTURACION VIAJE #masivo-{i} — {origen} → {destino} (remito {num_remito}) {detalle}")
                )
        self._insert('VIAJES',
                     'id_empresa, fecha_origen, tipo_carga, origen, destino, id_equipo, tarifa, tipo_tarifa, cantidad_cargada, resultado, comision, estado, fecha_llegada, pagador, numero_remito',
                     valores)
        self._movimientos(movimientos)

    def _movimientos(self, movimientos):
        if not movimientos:
            return
        valores = []
        for cuil_o_none, tipo_o_nombre, monto, fecha, concepto in movimientos:
            if cuil_o_none:  # cuenta de chofer por cuil
                sub = f"(SELECT id_cuenta FROM CUENTA WHERE cuil='{cuil_o_none}' AND tipo='CHOFER' AND id_empresa=@emp LIMIT 1)"
            else:  # cuenta de cliente por nombre
                nombre = tipo_o_nombre.split('CLIENTE_NOMBRE:', 1)[1]
                sub = f"(SELECT id_cuenta FROM CUENTA WHERE nombre='{esc(nombre)}' AND tipo='CLIENTE' AND id_empresa=@emp LIMIT 1)"
            valores.append(f"(@emp, {sub}, {monto}, '{fecha}', '{esc(concepto)[:255]}')")
        self._insert('MOVIMIENTOS', 'id_empresa, id_cuenta, monto, fecha, concepto', valores)

    def _consumos_combustible(self, equipos, proveedores):
        n = 6 * self.factor
        valores = []
        movimientos = []
        for i in range(n):
            eq = random.choice(equipos)
            prov = random.choice(proveedores)
            litros = round(random.uniform(150, 600), 2)
            precio = round(random.uniform(580, 720), 2)
            km = round(random.uniform(300, 1200), 2)
            fecha = fecha_aleatoria(365)
            valores.append(
                f"(@emp, '{esc(prov)}', '{esc(prov)}', "
                f"(SELECT id_equipo FROM EQUIPO e JOIN UNIDADES u ON u.id_unidad=e.id_unidad_principal "
                f"WHERE u.patente='{eq['pp']}' AND e.id_empresa=@emp LIMIT 1), "
                f"{litros}, {km}, {precio}, '{fecha}')"
            )
            movimientos.append((prov, round(litros * precio, 2), fecha,
                                f"CONSUMO COMBUSTIBLE #masivo-{i} — {litros} L en {prov}"))
        self._insert('CONSUMOS_COMBUSTIBLE',
                     'id_empresa, estacion_carga, proveedor, id_equipo, cantidad_litros, km_recorridos, precio_por_litro, fecha',
                     valores)
        self._movimientos_proveedor(movimientos)

    def _consumos_generales(self, unidades, proveedores):
        n = 5 * self.factor
        valores = []
        movimientos = []
        for i in range(n):
            u = random.choice(unidades)
            prov = random.choice(proveedores)
            monto = round(random.uniform(50000, 600000), 2)
            concepto = random.choice(CONCEPTOS_GEN)
            fecha = fecha_aleatoria(365)
            valores.append(
                f"(@emp, '{esc(prov)}', '{fecha}', "
                f"(SELECT id_unidad FROM UNIDADES WHERE patente='{u}' AND id_empresa=@emp LIMIT 1), "
                f"'{esc(concepto)}', {monto})"
            )
            movimientos.append((prov, monto, fecha,
                                f"CONSUMO GENERAL #masivo-{i} — {concepto}"))
        self._insert('CONSUMOS_GENERALES',
                     'id_empresa, proveedor, fecha, id_unidad, concepto, monto', valores)
        self._movimientos_proveedor(movimientos)

    def _gastos_admin(self, proveedores):
        n = 5 * self.factor
        valores = []
        movimientos = []
        for i in range(n):
            prov = random.choice(proveedores)
            monto = round(random.uniform(100000, 800000), 2)
            concepto = random.choice(CONCEPTOS_ADMIN)
            fecha = fecha_aleatoria(365)
            valores.append(f"(@emp, '{esc(prov)}', '{esc(concepto)}', '{fecha}', {monto})")
            movimientos.append((prov, monto, fecha,
                                f"GASTO ADMINISTRATIVO #masivo-{i} — {concepto}"))
        self._insert('GASTOS_ADMINISTRATIVOS',
                     'id_empresa, proveedor, concepto, fecha, monto', valores)
        self._movimientos_proveedor(movimientos)

    def _movimientos_proveedor(self, movimientos):
        """Crea movimientos de crédito a favor del proveedor (monto positivo)."""
        valores = []
        for prov, monto, fecha, concepto in movimientos:
            sub = f"(SELECT id_cuenta FROM CUENTA WHERE nombre='{esc(prov)}' AND tipo='PROVEEDOR' AND id_empresa=@emp LIMIT 1)"
            valores.append(f"(@emp, {sub}, {abs(monto)}, '{fecha}', '{esc(concepto)[:255]}')")
        self._insert('MOVIMIENTOS', 'id_empresa, id_cuenta, monto, fecha, concepto', valores)

    def _stock(self):
        n = 10 * self.factor
        valores = []
        for i in range(n):
            elemento = random.choice(ELEMENTOS_STOCK)
            deposito = random.choice(['Depósito Central', 'Galpón Norte', 'Taller', 'Depósito Sur'])
            valores.append(f"(@emp, '{esc(elemento)}', {round(random.uniform(5000, 350000),2)}, '{esc(deposito)}')")
        self._insert('STOCK', 'id_empresa, elemento, valuacion, deposito', valores)

    def _mantenimientos(self, unidades):
        n = 5 * self.factor
        valores = []
        for i in range(n):
            u = random.choice(unidades)
            valores.append(
                f"(@emp, (SELECT id_unidad FROM UNIDADES WHERE patente='{u}' AND id_empresa=@emp LIMIT 1), "
                f"'{random.choice(['Mensual','Trimestral','Semestral','Anual','Cada 20.000 km'])}', "
                f"'{fecha_futura_o_pasada(200)}', '{fecha_futura_o_pasada(120)}', '{esc(random.choice(CONCEPTOS_MANT))}')"
            )
        self._insert('MANTENIMIENTOS', 'id_empresa, id_unidad, periodicidad, fecha, fecha_vencimiento, concepto', valores)

    def _vencimientos(self, unidades):
        n = 6 * self.factor
        valores = []
        for i in range(n):
            u = random.choice(unidades)
            valores.append(
                f"(@emp, '{esc(random.choice(CONCEPTOS_VENC))}', '{fecha_futura_o_pasada(120)}', "
                f"(SELECT id_unidad FROM UNIDADES WHERE patente='{u}' AND id_empresa=@emp LIMIT 1))"
            )
        self._insert('VENCIMIENTOS', 'id_empresa, concepto, fecha_vencimiento, id_unidad', valores)

    def _cubiertas(self, unidades):
        n = 7 * self.factor
        valores = []
        for i in range(n):
            u = random.choice(unidades)
            valores.append(
                f"(@emp, '{random.choice(['295','315'])}-80-{random.randint(1000,9999)}', "
                f"'{random.choice(['Nueva','Buen estado','Media vida','Recapada','Desgaste alto'])}', "
                f"(SELECT id_unidad FROM UNIDADES WHERE patente='{u}' AND id_empresa=@emp LIMIT 1), "
                f"'{random.choice(['COLOCADA','AUXILIO'])}', '{fecha_futura_o_pasada(200)}')"
            )
        self._insert('CUBIERTAS', 'id_empresa, identificador, estado, id_unidad, ubicacion, fecha_colocacion', valores)

    def _insert(self, tabla, columnas, valores):
        if not valores:
            return
        self.lineas_por_tabla[tabla] = self.lineas_por_tabla.get(tabla, 0) + len(valores)
        # Insertar en lotes de 500 para no exceder max_allowed_packet
        LOTE = 500
        for j in range(0, len(valores), LOTE):
            grupo = valores[j:j+LOTE]
            self.add(f"INSERT INTO {tabla} ({columnas}) VALUES")
            self.add(',\n'.join(grupo) + ';')


def main():
    ap = argparse.ArgumentParser(description='Generador de datos de prueba TCV LogiSuite ERP')
    ap.add_argument('--factor', type=int, default=50, help='Multiplicador del volumen base (default 50)')
    ap.add_argument('--empresa', type=int, default=1, help='id_empresa destino (default 1)')
    args = ap.parse_args()

    gen = Generador(args.factor, args.empresa)
    salida = gen.generar()
    print(salida)
    # Resumen a stderr para no contaminar el SQL
    import sys
    total = sum(gen.lineas_por_tabla.values())
    print(f"\n-- Resumen: {total} filas generadas", file=sys.stderr)
    for t, n in sorted(gen.lineas_por_tabla.items()):
        print(f"--   {t}: {n}", file=sys.stderr)


if __name__ == '__main__':
    main()

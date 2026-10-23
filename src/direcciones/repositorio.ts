import type { Consultar } from '../bd/transaccion.js';
import { NoEncontrado } from '../errores.js';
import { aDireccion, type Direccion, type DireccionNueva, type FilaDireccion } from './modelo.js';

// Las consultas de direcciones (plan, Estructura). Como las de perfiles, cada función recibe `consultar`, el del pool o el de
// una `transaccion()`, así sirve dentro de la idempotencia del alta (T5) y fuera de ella. Todo va con parámetros SQL, nunca
// interpolado (plan, Privacidad). Una dirección se busca siempre por `(cliente_id, direccion_id)`: la de otro cliente no se
// distingue de una que no existe.

// Las columnas de `FilaDireccion`.
const COLUMNAS = 'direccion_id, tipo, alias, texto, latitud, longitud, creado_en';

const NO_EXISTE = 'No existe la dirección pedida';

// Guarda la dirección `direccionId` de `clienteId` (RF-2.2). `creado_en` lo pone la base. Los opcionales ausentes quedan en
// null; un alias vacío se guarda vacío. Que el perfil exista lo comprueba el servicio antes (plan, Lógica): sin él, la clave
// foránea de la base rechaza la fila. Un `direccionId` repetido da `Conflicto`, por la clave primaria.
export async function crearDireccion(
  consultar: Consultar,
  clienteId: string,
  direccionId: string,
  datos: DireccionNueva,
): Promise<Direccion> {
  const { rows } = await consultar<FilaDireccion>(
    `INSERT INTO direcciones_cliente (direccion_id, cliente_id, tipo, alias, texto, latitud, longitud)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNAS}`,
    [
      direccionId,
      clienteId,
      datos.tipo,
      datos.alias ?? null,
      datos.texto,
      datos.coordenadas?.latitud ?? null,
      datos.coordenadas?.longitud ?? null,
    ],
  );
  const fila = rows[0];
  // Un INSERT ... RETURNING siempre devuelve la fila que insertó.
  if (fila === undefined) throw new Error('El alta de la dirección no devolvió la fila');
  return aDireccion(fila);
}

// La dirección `direccionId` de `clienteId` (RF-2.2.2), o `NoEncontrado` si no existe o es de otro cliente (RF-2.2.2.1).
export async function obtenerDireccion(consultar: Consultar, clienteId: string, direccionId: string): Promise<Direccion> {
  const { rows } = await consultar<FilaDireccion>(
    `SELECT ${COLUMNAS} FROM direcciones_cliente WHERE cliente_id = $1 AND direccion_id = $2`,
    [clienteId, direccionId],
  );
  const fila = rows[0];
  if (fila === undefined) throw new NoEncontrado(NO_EXISTE);
  return aDireccion(fila);
}

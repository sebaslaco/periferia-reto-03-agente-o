---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra en SAP — maestros, reglas de control RC1–RC10 y qué hacer en cada excepción.
---

# Conocimiento del proceso: órdenes de compra (OC) en SAP

## Proceso
1. Llega un correo con tres piezas: solicitud (Excel normalizado a `solicitud.json`), cotización del proveedor (`cotizacion.txt`) y correo de aprobación del líder (`aprobacion.json`). A veces llega también la factura (`factura.txt`).
2. Se valida el paquete contra los maestros y las reglas RC1–RC10.
3. Se arma la OC tal como quedaría en SAP (sociedad 1000, organización de compras 1000) y se genera la evidencia de aprobación (texto + sha256, y PDF).
4. Si no hay bloqueos y las confirmaciones (si las hay) fueron aceptadas por la analista, se crea la OC. Una solicitud genera como máximo una OC.
5. Cada intento queda en el log de control (`out/control.csv`) para contabilidad y auditoría.

## Maestros (fixtures/reto-03/maestros)
| Maestro | Para qué se usa |
|---|---|
| `proveedores.json` | Existencia y estado del proveedor (RC1); código SAP; IVA y condiciones de pago por defecto (RC6, RC7). |
| `centros-costo.json` | Subáreas válidas (RC4) y aprobadores con su tope (RC2, RC3). |
| `indicadores-iva.json` | Significado de los códigos de IVA: C0 excluido, C1 19 %, C2 5 %. |
| `condiciones-pago.json` | Significado de las condiciones: Z000 inmediato, Z015 / Z030 / Z060 días fecha factura. |

## Reglas de control
| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe (por NIT; si la solicitud no trae NIT, por nombre normalizado) y está activo. | Bloqueo |
| RC2 | Hay aprobación, dice "Aprobado" y la envía un aprobador del centro de costo. | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador para ese centro. | Bloqueo |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo |
| RC5 | Cotización y solicitud difieren como máximo 2 %; sin cotización también se confirma. | Confirmación |
| RC6 | Sin indicador de IVA → se toma el del proveedor y se confirma. | Confirmación + derivado |
| RC7 | Sin condiciones de pago → se toman las del proveedor; solo se informa. | Derivado |
| RC8 | Factura con fecha anterior a la solicitud → compra retroactiva; se confirma y se marca. | Confirmación |
| RC9 | La aprobación tiene fecha (día) igual o posterior a la solicitud. | Confirmación |
| RC10 | Cantidad × valor unitario = valor total (± 1). | Bloqueo |

## Qué hacer en cada excepción
| Situación | Recomendación a la analista |
|---|---|
| RC1 proveedor inexistente | Pedir la creación del proveedor en el maestro (con RUT y datos bancarios) o corregir el NIT de la solicitud. No crear la OC. |
| RC1 proveedor inactivo | Pedir la reactivación o elegir otro proveedor activo. No crear la OC. |
| RC2 sin aprobación / sin "Aprobado" | Pedir al líder del centro una aprobación explícita por correo. |
| RC2 aprobador no autorizado | Pedir la aprobación a un aprobador del centro de costo de la solicitud. Aprobar desde otra área no vale. |
| RC3 monto sobre el tope | Pedir la aprobación de un aprobador con tope suficiente; si ninguno lo tiene, escalar a la dirección. |
| RC4 subárea inválida | Pedir al solicitante que corrija la subárea o el centro de costo. |
| RC5 diferencia con la cotización | Mostrar ambos valores. Confirmar con el solicitante cuál aplica; la OC se crea con el valor de la solicitud aprobada. |
| RC6 IVA derivado | Mostrar el indicador derivado y su tasa; crear solo si la analista confirma. |
| RC7 condiciones derivadas | Informar el código y su significado; no requiere confirmación. |
| RC8 compra retroactiva | Advertir que la factura llegó antes de la solicitud; crear solo con confirmación. Queda `retroactiva = true` en el control para medir el desvío. |
| RC9 aprobación anterior a la solicitud | Confirmar que la aprobación corresponde a esta solicitud. |
| RC10 totales que no cuadran | Pedir al solicitante que corrija cantidad, valor unitario o valor total. No crear la OC. |
| Paquete incompleto o datos ilegibles | Decir qué archivo falta o qué dato no se pudo leer y pedirlo al solicitante. |
| La solicitud ya tiene OC | Informar el número existente; nunca crear otra. |

## Payload de la OC
- Descripción de la posición: máximo 40 caracteres (texto breve de SAP).
- Posiciones numeradas 10, 20, 30…
- Unidad: `H` si la compra es por horas; `UN` por defecto.
- Cada valor tiene su fuente en `out/<caso>/trazabilidad.json`.
- Las excepciones confirmadas quedan en `excepciones[]` con `confirmado_por`.

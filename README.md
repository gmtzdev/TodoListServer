# Servidor de prueba

Requiere Node.js 22.18 o posterior (versión 22 o 24 en adelante).
Copia `.env.example` a `.env` si este archivo aún no existe. Instala las
dependencias, prepara la base de datos e inicia el servidor:

```sh
npm install
npm run build
npx prisma migrate deploy
npm start
```

El proyecto utiliza TypeScript y Prisma con SQLite. Para generar el cliente de
Prisma y compilar el proyecto, ejecuta:

```sh
npm run build
```

Ejecuta `npm test` para verificar el CRUD con una base de datos temporal.

El cliente está disponible en `src/prisma.ts`. Las migraciones crean las tablas
de usuarios, grupos y tareas; cada tarea pertenece a un usuario y se elimina
cuando se elimina su usuario. Después de modificar el esquema, crea una migración con
`npx prisma migrate dev --name nombre_del_cambio` y vuelve a ejecutar
`npm run build`.

Realiza una petición GET a `http://localhost:3000/health`. La respuesta esperada es:

```json
{"status":"ok"}
```

El puerto predeterminado es `3000`; puedes cambiarlo mediante la variable de entorno `PORT`.

## Documentación interactiva

Con el servidor iniciado, abre `http://localhost:3000/docs` para consultar y
probar los endpoints con Swagger UI. La especificación OpenAPI también está
disponible en `http://localhost:3000/openapi.json`. Desde otro dispositivo de
la LAN, sustituye `localhost` por la dirección IP del servidor. Los endpoints
están agrupados en Estado, Usuarios, Grupos y Tareas.

## Registrar un usuario

Envía una petición `POST` a `http://localhost:3000/users` con
`Content-Type: application/json`:

```json
{
  "name": "Ana",
  "email": "ana@example.com",
  "password": "una-clave-segura",
  "photoUrl": "https://example.com/foto.jpg"
}
```

La contraseña debe tener al menos 8 caracteres y un máximo de 1024 bytes. Se
guarda como hash con scrypt y no se devuelve en la respuesta. El correo se
normaliza a minúsculas y debe ser único. La respuesta incluye `id`, `name`,
`email` y `photoUrl`; los datos inválidos reciben HTTP 400 y un correo duplicado
recibe HTTP 409.

## CRUD de usuarios

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/users` | Crear un usuario. |
| `GET` | `/users` | Listar usuarios. |
| `GET` | `/users/:id` | Consultar un usuario por su ID. |
| `PATCH` | `/users/:id` | Actualizar uno o más campos: `name`, `email`, `password` o `photoUrl`. |
| `DELETE` | `/users/:id` | Eliminar un usuario; devuelve HTTP 204 sin contenido. |

Para actualizar, envía un objeto JSON con los campos que quieras cambiar. Se
aplican las mismas validaciones que al registrar; un objeto vacío o campos
desconocidos reciben HTTP 400. Un ID inexistente recibe HTTP 404. Las
respuestas nunca incluyen la contraseña ni su hash.

## CRUD de grupos

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/groups` | Crear un grupo. |
| `GET` | `/groups` | Listar grupos. |
| `GET` | `/groups/:id` | Consultar un grupo. |
| `PATCH` | `/groups/:id` | Actualizar el nombre o reemplazar la lista de miembros. |
| `DELETE` | `/groups/:id` | Eliminar un grupo; devuelve HTTP 204. |

Para crear un grupo envía, por ejemplo, `{"name":"Equipo","memberIds":["ID-del-usuario"]}`.
El nombre es obligatorio y no puede estar vacío; `memberIds` es opcional, debe
contener IDs distintos de usuarios existentes y por defecto es una lista vacía.
La respuesta contiene `id`, `name` y `memberIds`. En `PATCH`, `memberIds`
reemplaza la lista completa; `[]` elimina todos los miembros. No se puede retirar
a un miembro mientras esté asignado a alguna tarea del grupo: primero cambia
la asignación de la tarea. Esta operación devuelve HTTP 409.

Al eliminar un grupo, sus tareas y sus asignaciones de usuarios se conservan,
pero quedan sin grupo.

### Membresías

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/groups/:id/members` | Añadir un usuario enviando `{"userId":"ID-del-usuario"}`. |
| `GET` | `/groups/:id/members` | Listar las membresías del grupo. |
| `GET` | `/groups/:id/members/:userId` | Consultar una membresía. |
| `DELETE` | `/groups/:id/members/:userId` | Retirar al usuario del grupo. |
| `GET` | `/users/:id/groups` | Listar los grupos del usuario (`id` y `name`). |

Las membresías se devuelven como `{"groupId":"...","userId":"..."}`.
Crear una relación existente devuelve HTTP 409; un grupo, usuario o membresía
inexistente devuelve HTTP 404. La eliminación devuelve HTTP 204, o HTTP 409 si
el usuario tiene tareas asignadas del grupo. Como la membresía no tiene otros
campos editables, para reemplazar varios miembros utiliza `PATCH /groups/:id`
con la lista completa `memberIds`.

## CRUD de tareas

| Método | Ruta | Acción |
| --- | --- | --- |
| `POST` | `/tasks` | Crear una tarea para un usuario existente. |
| `GET` | `/tasks` | Listar todas las tareas. |
| `GET` | `/users/:id/tasks` | Listar las tareas relacionadas con un usuario. |
| `GET` | `/tasks/:id` | Consultar una tarea por su ID. |
| `PATCH` | `/tasks/:id` | Actualizar los campos editables o las asignaciones. |
| `DELETE` | `/tasks/:id` | Eliminar una tarea; devuelve HTTP 204 sin contenido. |

`GET /users/:id/tasks` incluye las tareas de las que el usuario es propietario,
las asignadas directamente y todas las tareas de los grupos a los que pertenece.
Cada tarea aparece una sola vez, aunque cumpla varios criterios. Devuelve una
lista vacía si no hay tareas y HTTP 404 si el usuario no existe.

Ejemplo de `POST /tasks` con `Content-Type: application/json`:

```json
{
  "title": "Preparar informe",
  "description": "Revisar los resultados",
  "userId": "ID-del-usuario"
}
```

`title` y `userId` son obligatorios; el título no puede estar vacío.
`description` es opcional y admite `null`; `completed` es opcional y, por
defecto, es `false`. La respuesta incluye `id`, `title`, `description`,
`completed`, `userId`, `groupId` y `assigneeIds`. Se pueden incluir `groupId`
opcional y `assigneeIds` con IDs distintos de usuarios adicionales. Si la tarea
tiene grupo, los usuarios adicionales deben ser miembros del grupo; el
propietario `userId` sigue siendo obligatorio y no necesita ser miembro.
Sin grupo, se pueden asignar usuarios existentes de cualquier grupo o sin grupo.
En `PATCH` se pueden enviar uno o más campos
editables; `description: null` elimina la descripción. Los datos inválidos
reciben HTTP 400 y un usuario, grupo o tarea inexistente recibe HTTP 404.
`assigneeIds` reemplaza la lista completa y `[]` elimina las asignaciones;
`groupId: null` desvincula el grupo. Al cambiar de grupo se validan también
las asignaciones existentes; envía simultáneamente `assigneeIds` si es
necesario reemplazarlas. El propietario `userId` no se puede modificar.

**Estos endpoints no tienen autenticación ni autorización**: cualquier
dispositivo que pueda acceder al servidor puede consultar, modificar o
eliminar usuarios, grupos y tareas. No lo expongas a redes no confiables.

El servidor usa HTTP sin cifrar. Para transmitir contraseñas de forma segura,
utiliza HTTPS mediante un proxy antes de exponerlo fuera de un entorno de prueba.

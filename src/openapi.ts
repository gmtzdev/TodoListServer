const userProperties = {
  name: { type: 'string', description: 'Nombre no vacío.' },
  email: { type: 'string', format: 'email', description: 'Correo único; se normaliza a minúsculas.' },
  password: {
    type: 'string',
    format: 'password',
    minLength: 8,
    writeOnly: true,
    description: 'Mínimo 8 caracteres y máximo 1024 bytes en UTF-8.',
  },
  photoUrl: { type: 'string', format: 'uri', description: 'URL HTTP o HTTPS de la foto.' },
};

const taskProperties = {
  title: { type: 'string', description: 'Título no vacío; se eliminan los espacios al inicio y al final.' },
  description: { type: 'string', nullable: true },
  completed: { type: 'boolean', default: false },
  groupId: { type: 'string', nullable: true, description: 'Grupo opcional responsable de la tarea.' },
  assigneeIds: {
    type: 'array',
    uniqueItems: true,
    items: { type: 'string' },
    description: 'IDs de usuarios adicionales; deben pertenecer al grupo si existe.',
  },
};
const groupProperties = {
  name: { type: 'string', description: 'Nombre no vacío.' },
  memberIds: { type: 'array', uniqueItems: true, items: { type: 'string' } },
};

const userResponse = {
  description: 'Usuario sin contraseña ni hash.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
};
const taskResponse = {
  description: 'Tarea.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
};
const groupResponse = {
  description: 'Grupo y sus miembros.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Group' } } },
};
const memberResponse = {
  description: 'Membresía del usuario en el grupo.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/GroupMember' } } },
};
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'ID del usuario.',
  schema: { type: 'string' },
};

export const openapiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'API de usuarios, grupos y tareas',
    version: '1.0.0',
    description: 'API sin autenticación ni autorización. Usa HTTPS antes de transmitir contraseñas fuera de un entorno de prueba.',
  },
  tags: [
    { name: 'Estado' },
    { name: 'Usuarios' },
    { name: 'Grupos' },
    { name: 'Tareas' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Estado'],
        summary: 'Comprobar la conexión',
        responses: {
          '200': {
            description: 'Servidor disponible.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { type: 'string', example: 'ok' } },
                },
              },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summaty: "Inicia sesion",
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } }
        },
        responses: {
          '200' : {
            descripcion: 'Inicio de sesion correcto.',
            content: {
              'applicaciton/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status : {type: 'string', example: 'ok'}}
                }
              }
            }
          }
        }
      }
    },
    '/users': {
      get: {
        tags: ['Usuarios'],
        summary: 'Listar usuarios',
        responses: {
          '200': {
            description: 'Lista de usuarios.',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
          '500': errorResponse('Error al consultar los usuarios.'),
        },
      },
      post: {
        tags: ['Usuarios'],
        summary: 'Registrar un usuario',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } } },
        },
        responses: {
          '201': userResponse,
          '400': errorResponse('Datos inválidos. Un JSON mal formado puede recibir una respuesta HTML.'),
          '409': errorResponse('Correo electrónico ya registrado.'),
          '500': errorResponse('Error al registrar el usuario.'),
        },
      },
    },
    '/users/{id}': {
      parameters: [idParameter],
      get: {
        tags: ['Usuarios'],
        summary: 'Consultar un usuario',
        responses: {
          '200': userResponse,
          '404': errorResponse('Usuario no encontrado.'),
          '500': errorResponse('Error al consultar el usuario.'),
        },
      },
      patch: {
        tags: ['Usuarios'],
        summary: 'Actualizar un usuario',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUser' } } },
        },
        responses: {
          '200': userResponse,
          '400': errorResponse('Datos inválidos. Un JSON mal formado puede recibir una respuesta HTML.'),
          '404': errorResponse('Usuario no encontrado.'),
          '409': errorResponse('Correo electrónico ya registrado.'),
          '500': errorResponse('Error al actualizar el usuario.'),
        },
      },
      delete: {
        tags: ['Usuarios'],
        summary: 'Eliminar un usuario',
        responses: {
          '204': { description: 'Usuario eliminado.' },
          '404': errorResponse('Usuario no encontrado.'),
          '500': errorResponse('Error al eliminar el usuario.'),
        },
      },
    },
    '/users/{id}/groups': {
      parameters: [idParameter],
      get: {
        tags: ['Usuarios'],
        summary: 'Listar los grupos de un usuario',
        responses: {
          '200': {
            description: 'Grupos del usuario.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GroupSummary' } } } },
          },
          '404': errorResponse('Usuario no encontrado.'),
          '500': errorResponse('Error al consultar los grupos.'),
        },
      },
    },
    '/users/{id}/tasks': {
      parameters: [idParameter],
      get: {
        tags: ['Usuarios'],
        summary: 'Listar tareas relacionadas con un usuario',
        description: 'Incluye tareas propias, asignaciones directas y tareas de sus grupos, sin duplicados.',
        responses: {
          '200': {
            description: 'Tareas relacionadas con el usuario.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } },
          },
          '404': errorResponse('Usuario no encontrado.'),
          '500': errorResponse('Error al consultar las tareas.'),
        },
      },
    },
    '/groups': {
      get: {
        tags: ['Grupos'],
        summary: 'Listar grupos',
        responses: {
          '200': {
            description: 'Lista de grupos.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Group' } } } },
          },
          '500': errorResponse('Error al consultar los grupos.'),
        },
      },
      post: {
        tags: ['Grupos'],
        summary: 'Crear un grupo',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateGroup' } } },
        },
        responses: {
          '201': groupResponse,
          '400': errorResponse('Datos inválidos.'),
          '404': errorResponse('Usuario no encontrado.'),
          '500': errorResponse('Error al crear el grupo.'),
        },
      },
    },
    '/groups/{id}': {
      parameters: [{ ...idParameter, description: 'ID del grupo.' }],
      get: {
        tags: ['Grupos'],
        summary: 'Consultar un grupo',
        responses: {
          '200': groupResponse,
          '404': errorResponse('Grupo no encontrado.'),
          '500': errorResponse('Error al consultar el grupo.'),
        },
      },
      patch: {
        tags: ['Grupos'],
        summary: 'Actualizar un grupo y reemplazar sus miembros',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateGroup' } } },
        },
        responses: {
          '200': groupResponse,
          '400': errorResponse('Datos inválidos.'),
          '404': errorResponse('Grupo o usuario no encontrado.'),
          '409': errorResponse('Un miembro que se quiere retirar tiene tareas asignadas del grupo.'),
          '500': errorResponse('Error al actualizar el grupo.'),
        },
      },
      delete: {
        tags: ['Grupos'],
        summary: 'Eliminar un grupo',
        responses: {
          '204': { description: 'Grupo eliminado; las tareas conservan su propietario y asignaciones.' },
          '404': errorResponse('Grupo no encontrado.'),
          '500': errorResponse('Error al eliminar el grupo.'),
        },
      },
    },
    '/groups/{id}/members': {
      parameters: [{ ...idParameter, description: 'ID del grupo.' }],
      get: {
        tags: ['Grupos'],
        summary: 'Listar miembros de un grupo',
        responses: {
          '200': {
            description: 'Membresías del grupo.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/GroupMember' } } } },
          },
          '404': errorResponse('Grupo no encontrado.'),
          '500': errorResponse('Error al consultar los miembros.'),
        },
      },
      post: {
        tags: ['Grupos'],
        summary: 'Añadir un usuario a un grupo',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                additionalProperties: false,
                properties: { userId: { type: 'string', format: 'uuid' } },
              },
            },
          },
        },
        responses: {
          '201': memberResponse,
          '400': errorResponse('Datos inválidos.'),
          '404': errorResponse('Grupo o usuario no encontrado.'),
          '409': errorResponse('El usuario ya pertenece al grupo.'),
          '500': errorResponse('Error al añadir el miembro.'),
        },
      },
    },
    '/groups/{id}/members/{userId}': {
      parameters: [
        { ...idParameter, description: 'ID del grupo.' },
        { name: 'userId', in: 'path', required: true, description: 'ID del usuario.', schema: { type: 'string' } },
      ],
      get: {
        tags: ['Grupos'],
        summary: 'Consultar una membresía',
        responses: {
          '200': memberResponse,
          '404': errorResponse('Membresía no encontrada.'),
          '500': errorResponse('Error al consultar la membresía.'),
        },
      },
      delete: {
        tags: ['Grupos'],
        summary: 'Retirar a un usuario de un grupo',
        responses: {
          '204': { description: 'Membresía eliminada.' },
          '404': errorResponse('Membresía no encontrada.'),
          '409': errorResponse('El usuario tiene tareas asignadas del grupo.'),
          '500': errorResponse('Error al retirar el miembro.'),
        },
      },
    },
    '/tasks': {
      get: {
        tags: ['Tareas'],
        summary: 'Listar tareas',
        responses: {
          '200': {
            description: 'Lista de tareas.',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
              },
            },
          },
          '500': errorResponse('Error al consultar las tareas.'),
        },
      },
      post: {
        tags: ['Tareas'],
        summary: 'Crear una tarea',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTask' } } },
        },
        responses: {
          '201': taskResponse,
          '400': errorResponse('Datos inválidos o usuarios asignados que no pertenecen al grupo.'),
          '404': errorResponse('Usuario o grupo no encontrado.'),
          '500': errorResponse('Error al crear la tarea.'),
        },
      },
    },
    '/tasks/{id}': {
      parameters: [{ ...idParameter, description: 'ID de la tarea.' }],
      get: {
        tags: ['Tareas'],
        summary: 'Consultar una tarea',
        responses: {
          '200': taskResponse,
          '404': errorResponse('Tarea no encontrada.'),
          '500': errorResponse('Error al consultar la tarea.'),
        },
      },
      patch: {
        tags: ['Tareas'],
        summary: 'Actualizar una tarea',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTask' } } },
        },
        responses: {
          '200': taskResponse,
          '400': errorResponse('Datos inválidos o usuarios asignados que no pertenecen al grupo.'),
          '404': errorResponse('Tarea, usuario o grupo no encontrado.'),
          '500': errorResponse('Error al actualizar la tarea.'),
        },
      },
      delete: {
        tags: ['Tareas'],
        summary: 'Eliminar una tarea',
        responses: {
          '204': { description: 'Tarea eliminada.' },
          '404': errorResponse('Tarea no encontrada.'),
          '500': errorResponse('Error al eliminar la tarea.'),
        },
      },
    },
  },
  components: {
    schemas: {
      Login: {
        type: 'object',
        required: ['name', 'password'],
        properties: {
          name: userProperties.name,
          password: userProperties.password
        }
      },
      User: {
        type: 'object',
        required: ['id', 'name', 'email', 'photoUrl'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: userProperties.name,
          email: userProperties.email,
          photoUrl: userProperties.photoUrl,
        },
      },
      CreateUser: {
        type: 'object',
        required: ['name', 'email', 'password', 'photoUrl'],
        properties: userProperties,
      },
      UpdateUser: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: userProperties,
      },
      Group: {
        type: 'object',
        required: ['id', 'name', 'memberIds'],
        properties: { id: { type: 'string', format: 'uuid' }, ...groupProperties },
      },
      GroupSummary: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string', format: 'uuid' }, name: groupProperties.name },
      },
      GroupMember: {
        type: 'object',
        required: ['groupId', 'userId'],
        properties: { groupId: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } },
      },
      CreateGroup: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: groupProperties,
      },
      UpdateGroup: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: groupProperties,
      },
      Task: {
        type: 'object',
        required: ['id', 'title', 'description', 'completed', 'userId', 'groupId', 'assigneeIds'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          ...taskProperties,
          userId: { type: 'string', format: 'uuid' },
        },
      },
      CreateTask: {
        type: 'object',
        required: ['title', 'userId'],
        additionalProperties: false,
        properties: { ...taskProperties, userId: { type: 'string', format: 'uuid' } },
      },
      UpdateTask: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: taskProperties,
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
    },
  },
};

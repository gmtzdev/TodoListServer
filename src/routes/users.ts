import { randomBytes, scrypt } from 'node:crypto';
import { Router, type Response } from 'express';
import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../prisma.ts';
import { taskInclude, taskResponse } from '../taskResponse.ts';

export const usersRouter = Router();

const userFields = { id: true, name: true, email: true, photoUrl: true } satisfies Prisma.UserSelect;

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(`scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`);
      }
    });
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 1024 && Array.from(value).length >= 8;
}

function validPhotoUrl(value: unknown): value is string {
  return typeof value === 'string' && isHttpUrl(value);
}

function handleDatabaseError(error: unknown, res: Response): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
  }
  console.error('Error al procesar usuarios:', error);
  res.status(500).json({ error: 'No se pudo procesar la solicitud.' });
}

usersRouter.get('/', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ select: userFields });
    res.json(users);
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.get('/:id/groups', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { memberships: { select: { group: { select: { id: true, name: true } } }, orderBy: { groupId: 'asc' } } },
    });
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    res.json(user.memberships.map(({ group }) => group));
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.get('/:id/tasks', async (req, res) => {
  try {
    const userId = req.params.id;
    const tasks = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return null;
      return tx.task.findMany({
        where: {
          OR: [
            { userId },
            { assignees: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
        include: taskInclude,
      });
    });
    if (!tasks) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    res.json(tasks.map(taskResponse));
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: userFields });
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado.' });
      return;
    }
    res.json(user);
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.post('/', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }

  const { name, email, password, photoUrl } = body as Record<string, unknown>;
  if (
    !validName(name) || !validEmail(email) ||
    !validPassword(password) || !validPhotoUrl(photoUrl)
  ) {
    res.status(400).json({ error: 'Nombre, correo, contraseña (mínimo 8 caracteres) o URL de foto inválidos.' });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: await hashPassword(password),
        photoUrl,
      },
      select: userFields,
    });
    res.status(201).json(user);
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.patch('/:id', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }

  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (
    keys.length === 0 ||
    keys.some((key) => !['name', 'email', 'password', 'photoUrl'].includes(key)) ||
    ('name' in fields && !validName(fields.name)) ||
    ('email' in fields && !validEmail(fields.email)) ||
    ('password' in fields && !validPassword(fields.password)) ||
    ('photoUrl' in fields && !validPhotoUrl(fields.photoUrl))
  ) {
    res.status(400).json({ error: 'Los datos de actualización son inválidos.' });
    return;
  }

  try {
    const data: Prisma.UserUpdateInput = {};
    if (validName(fields.name)) data.name = fields.name.trim();
    if (validEmail(fields.email)) data.email = fields.email.trim().toLowerCase();
    if (validPassword(fields.password)) data.passwordHash = await hashPassword(fields.password);
    if (validPhotoUrl(fields.photoUrl)) data.photoUrl = fields.photoUrl;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: userFields,
    });
    res.json(user);
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

usersRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    handleDatabaseError(error, res);
  }
});

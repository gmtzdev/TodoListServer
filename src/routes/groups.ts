import { Router } from 'express';
import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../prisma.ts';
import { handleRelationError, RequestError, validIdList } from './relations.ts';

export const groupsRouter = Router();

const groupInclude = { members: { select: { userId: true }, orderBy: { userId: 'asc' } } } satisfies Prisma.GroupInclude;
type GroupWithMembers = Prisma.GroupGetPayload<{ include: typeof groupInclude }>;

function groupResponse({ members, ...group }: GroupWithMembers) {
  return { ...group, memberIds: members.map(({ userId }) => userId) };
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

async function ensureMembersCanLeave(tx: Prisma.TransactionClient, groupId: string, userId: string | Prisma.StringFilter) {
  const assigned = await tx.taskAssignee.count({ where: { task: { groupId }, userId } });
  if (assigned) throw new RequestError(409, 'No se puede retirar a usuarios asignados a tareas del grupo.');
}

groupsRouter.get('/:id/members', async (req, res) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id }, include: groupInclude });
    if (!group) throw new RequestError(404, 'Grupo no encontrado.');
    res.json(group.members.map(({ userId }) => ({ groupId: group.id, userId })));
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.get('/:id/members/:userId', async (req, res) => {
  try {
    const member = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId: req.params.userId } },
    });
    if (!member) throw new RequestError(404, 'Membresía no encontrada.');
    res.json(member);
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.post('/:id/members', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== 'userId') ||
      typeof fields.userId !== 'string' || !fields.userId.trim()) {
    res.status(400).json({ error: 'Se requiere un ID de usuario válido.' });
    return;
  }
  const userId = fields.userId;
  try {
    const member = await prisma.$transaction(async (tx) => {
      if (!await tx.group.findUnique({ where: { id: req.params.id }, select: { id: true } })) {
        throw new RequestError(404, 'Grupo no encontrado.');
      }
      if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) {
        throw new RequestError(404, 'Usuario no encontrado.');
      }
      if (await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: req.params.id, userId } } })) {
        throw new RequestError(409, 'El usuario ya pertenece al grupo.');
      }
      return tx.groupMember.create({ data: { groupId: req.params.id, userId } });
    });
    res.status(201).json(member);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'El usuario ya pertenece al grupo.' });
      return;
    }
    handleRelationError(error, res);
  }
});

groupsRouter.delete('/:id/members/:userId', async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const where = { groupId_userId: { groupId: req.params.id, userId: req.params.userId } };
      if (!await tx.groupMember.findUnique({ where })) throw new RequestError(404, 'Membresía no encontrada.');
      await ensureMembersCanLeave(tx, req.params.id, req.params.userId);
      await tx.groupMember.delete({ where });
    });
    res.status(204).end();
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.get('/', async (_req, res) => {
  try {
    res.json((await prisma.group.findMany({ include: groupInclude })).map(groupResponse));
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.get('/:id', async (req, res) => {
  try {
    const group = await prisma.group.findUnique({ where: { id: req.params.id }, include: groupInclude });
    if (!group) throw new RequestError(404, 'Grupo no encontrado.');
    res.json(groupResponse(group));
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.post('/', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }
  const fields = body as Record<string, unknown>;
  if (
    Object.keys(fields).some((key) => !['name', 'memberIds'].includes(key)) ||
    !validName(fields.name) ||
    ('memberIds' in fields && !validIdList(fields.memberIds))
  ) {
    res.status(400).json({ error: 'Los datos del grupo son inválidos.' });
    return;
  }

  const name = fields.name.trim();
  const memberIds = validIdList(fields.memberIds) ? fields.memberIds : [];
  try {
    const group = await prisma.$transaction(async (tx) => {
      if (await tx.user.count({ where: { id: { in: memberIds } } }) !== memberIds.length) {
        throw new RequestError(404, 'Uno o más usuarios no existen.');
      }
      return tx.group.create({
        data: {
          name,
          members: { create: memberIds.map((userId) => ({ user: { connect: { id: userId } } })) },
        },
        include: groupInclude,
      });
    });
    res.status(201).json(groupResponse(group));
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.patch('/:id', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (
    keys.length === 0 ||
    keys.some((key) => !['name', 'memberIds'].includes(key)) ||
    ('name' in fields && !validName(fields.name)) ||
    ('memberIds' in fields && !validIdList(fields.memberIds))
  ) {
    res.status(400).json({ error: 'Los datos de actualización son inválidos.' });
    return;
  }

  try {
    const group = await prisma.$transaction(async (tx) => {
      const current = await tx.group.findUnique({ where: { id: req.params.id } });
      if (!current) throw new RequestError(404, 'Grupo no encontrado.');
      if (validIdList(fields.memberIds)) {
        const memberIds = fields.memberIds;
        if (await tx.user.count({ where: { id: { in: memberIds } } }) !== memberIds.length) {
          throw new RequestError(404, 'Uno o más usuarios no existen.');
        }
        await ensureMembersCanLeave(tx, current.id, { notIn: memberIds });
        await tx.groupMember.deleteMany({ where: { groupId: current.id, userId: { notIn: memberIds } } });
        for (const userId of memberIds) {
          await tx.groupMember.upsert({
            where: { groupId_userId: { groupId: current.id, userId } },
            create: { groupId: current.id, userId },
            update: {},
          });
        }
      }
      return tx.group.update({
        where: { id: current.id },
        data: validName(fields.name) ? { name: fields.name.trim() } : {},
        include: groupInclude,
      });
    });
    res.json(groupResponse(group));
  } catch (error) {
    handleRelationError(error, res);
  }
});

groupsRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.group.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    handleRelationError(error, res);
  }
});

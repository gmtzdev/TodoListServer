import { Router, type Response } from 'express';
import { Prisma } from '../generated/prisma/client.ts';
import { prisma } from '../prisma.ts';
import { taskInclude, taskResponse } from '../taskResponse.ts';
import { handleRelationError, RequestError, validIdList } from './relations.ts';

export const tasksRouter = Router();

function validTitle(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

async function validateAssignment(tx: Prisma.TransactionClient, groupId: string | null, assigneeIds: string[]) {
  if (groupId && !await tx.group.findUnique({ where: { id: groupId }, select: { id: true } })) {
    throw new RequestError(404, 'Grupo no encontrado.');
  }
  if (await tx.user.count({ where: { id: { in: assigneeIds } } }) !== assigneeIds.length) {
    throw new RequestError(404, 'Uno o más usuarios asignados no existen.');
  }
  if (groupId && await tx.groupMember.count({ where: { groupId, userId: { in: assigneeIds } } }) !== assigneeIds.length) {
    throw new RequestError(400, 'Los usuarios asignados deben pertenecer al grupo.');
  }
}

function handleDatabaseError(error: unknown, res: Response, notFound: string): void {
  if (error instanceof RequestError) {
    handleRelationError(error, res);
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')) {
    res.status(404).json({ error: notFound });
    return;
  }
  console.error('Error al procesar tareas:', error);
  res.status(500).json({ error: 'No se pudo procesar la solicitud.' });
}

tasksRouter.get('/', async (_req, res) => {
  try {
    res.json((await prisma.task.findMany({ include: taskInclude })).map(taskResponse));
  } catch (error) {
    handleDatabaseError(error, res, 'Tarea no encontrada.');
  }
});

tasksRouter.get('/:id', async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id }, include: taskInclude });
    if (!task) {
      res.status(404).json({ error: 'Tarea no encontrada.' });
      return;
    }
    res.json(taskResponse(task));
  } catch (error) {
    handleDatabaseError(error, res, 'Tarea no encontrada.');
  }
});

tasksRouter.post('/', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }

  const fields = body as Record<string, unknown>;
  if (
    Object.keys(fields).some((key) => !['title', 'description', 'completed', 'userId', 'groupId', 'assigneeIds'].includes(key)) ||
    !validTitle(fields.title) ||
    typeof fields.userId !== 'string' || !fields.userId.trim() ||
    ('description' in fields && fields.description !== null && typeof fields.description !== 'string') ||
    ('completed' in fields && typeof fields.completed !== 'boolean') ||
    ('groupId' in fields && fields.groupId !== null && (typeof fields.groupId !== 'string' || !fields.groupId.trim())) ||
    ('assigneeIds' in fields && !validIdList(fields.assigneeIds))
  ) {
    res.status(400).json({ error: 'Los datos de la tarea son inválidos.' });
    return;
  }

  try {
    const data: Prisma.TaskCreateInput = {
      title: fields.title.trim(),
      user: { connect: { id: fields.userId } },
    };
    if (fields.description === null || typeof fields.description === 'string') data.description = fields.description;
    if (typeof fields.completed === 'boolean') data.completed = fields.completed;
    const groupId = typeof fields.groupId === 'string' ? fields.groupId : null;
    const assigneeIds = validIdList(fields.assigneeIds) ? fields.assigneeIds : [];
    if (groupId) data.group = { connect: { id: groupId } };
    data.assignees = { create: assigneeIds.map((userId) => ({ user: { connect: { id: userId } } })) };
    const task = await prisma.$transaction(async (tx) => {
      await validateAssignment(tx, groupId, assigneeIds);
      return tx.task.create({ data, include: taskInclude });
    });
    res.status(201).json(taskResponse(task));
  } catch (error) {
    handleDatabaseError(error, res, 'Usuario no encontrado.');
  }
});

tasksRouter.patch('/:id', async (req, res) => {
  const body: unknown = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'Se requiere un objeto JSON.' });
    return;
  }

  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (
    keys.length === 0 ||
    keys.some((key) => !['title', 'description', 'completed', 'groupId', 'assigneeIds'].includes(key)) ||
    ('title' in fields && !validTitle(fields.title)) ||
    ('description' in fields && fields.description !== null && typeof fields.description !== 'string') ||
    ('completed' in fields && typeof fields.completed !== 'boolean') ||
    ('groupId' in fields && fields.groupId !== null && (typeof fields.groupId !== 'string' || !fields.groupId.trim())) ||
    ('assigneeIds' in fields && !validIdList(fields.assigneeIds))
  ) {
    res.status(400).json({ error: 'Los datos de actualización son inválidos.' });
    return;
  }

  try {
    const data: Prisma.TaskUpdateInput = {};
    if (validTitle(fields.title)) data.title = fields.title.trim();
    if (fields.description === null || typeof fields.description === 'string') data.description = fields.description;
    if (typeof fields.completed === 'boolean') data.completed = fields.completed;
    const task = await prisma.$transaction(async (tx) => {
      const current = await tx.task.findUnique({ where: { id: req.params.id }, include: taskInclude });
      if (!current) throw new RequestError(404, 'Tarea no encontrada.');
      const groupId = 'groupId' in fields ? (typeof fields.groupId === 'string' ? fields.groupId : null) : current.groupId;
      const assigneeIds = validIdList(fields.assigneeIds) ? fields.assigneeIds : current.assignees.map(({ userId }) => userId);
      await validateAssignment(tx, groupId, assigneeIds);
      if ('groupId' in fields) data.group = groupId ? { connect: { id: groupId } } : { disconnect: true };
      if (validIdList(fields.assigneeIds)) {
        await tx.taskAssignee.deleteMany({ where: { taskId: current.id } });
        data.assignees = { create: assigneeIds.map((userId) => ({ user: { connect: { id: userId } } })) };
      }
      return tx.task.update({ where: { id: current.id }, data, include: taskInclude });
    });
    res.json(taskResponse(task));
  } catch (error) {
    handleDatabaseError(error, res, 'Tarea no encontrada.');
  }
});

tasksRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.task.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    handleDatabaseError(error, res, 'Tarea no encontrada.');
  }
});

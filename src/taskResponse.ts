import { Prisma } from './generated/prisma/client.ts';

export const taskInclude = { assignees: { select: { userId: true }, orderBy: { userId: 'asc' } } } satisfies Prisma.TaskInclude;
type TaskWithAssignees = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function taskResponse({ assignees, ...task }: TaskWithAssignees) {
  return { ...task, assigneeIds: assignees.map(({ userId }) => userId) };
}

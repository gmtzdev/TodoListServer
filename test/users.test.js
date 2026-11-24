import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import Database from 'better-sqlite3';

test('la migración conserva usuarios y tareas existentes', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    for (const migration of ['20261124003128_create_users', '20261124010000_create_tasks']) {
      db.exec(readFileSync(resolve('prisma', 'migrations', migration, 'migration.sql'), 'utf8'));
    }
    db.prepare('INSERT INTO "User" (id, name, email, passwordHash, photoUrl) VALUES (?, ?, ?, ?, ?)')
      .run('user-1', 'Ana', 'ana@example.com', 'hash', 'https://example.com');
    db.prepare('INSERT INTO "Task" (id, title, userId) VALUES (?, ?, ?)').run('task-1', 'Tarea', 'user-1');
    db.exec(readFileSync(resolve('prisma', 'migrations', '20261124020000_create_groups_and_assignments', 'migration.sql'), 'utf8'));
    assert.deepEqual(db.prepare('SELECT id, title, userId, groupId FROM "Task"').get(), {
      id: 'task-1', title: 'Tarea', userId: 'user-1', groupId: null,
    });
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('realiza el CRUD de usuarios y valida los datos', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'todolist-test-'));
  let server;
  t.after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      server.kill();
      await new Promise((resolveExit) => server.once('exit', resolveExit));
    }
    await rm(directory, { recursive: true, force: true });
  });
  const url = `file:${join(directory, 'test.db')}`;
  const env = { ...process.env, DATABASE_URL: url };
  const migration = spawnSync(process.execPath, [
    resolve('node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy',
  ], { env, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);

  const socket = createServer();
  await new Promise((resolveListen, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolveListen);
  });
  const port = socket.address().port;
  await new Promise((resolveClose, reject) => socket.close((error) => error ? reject(error) : resolveClose()));

  server = spawn(process.execPath, ['src/server.ts'], {
    env: { ...env, PORT: String(port) },
    stdio: 'ignore',
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) break;
    try {
      ready = (await fetch(`${base}/health`)).ok;
      if (ready) break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  assert.ok(ready, 'El servidor no inició');

  const docs = await fetch(`${base}/docs/`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui-bundle\.js/);
  assert.equal((await fetch(`${base}/docs/swagger-ui-bundle.js`)).status, 200);
  const init = await fetch(`${base}/docs/swagger-ui-init.js`);
  assert.equal(init.status, 200);
  assert.match(await init.text(), /"\/users\/\{id\}"/);
  const specification = await fetch(`${base}/openapi.json`);
  assert.equal(specification.status, 200);
  const openapi = await specification.json();
  assert.equal(openapi.openapi, '3.0.3');
  for (const [path, methods, tag] of [
    ['/health', ['get'], 'Estado'],
    ['/users', ['get', 'post'], 'Usuarios'],
    ['/users/{id}', ['get', 'patch', 'delete'], 'Usuarios'],
    ['/users/{id}/groups', ['get'], 'Usuarios'],
    ['/users/{id}/tasks', ['get'], 'Usuarios'],
    ['/groups', ['get', 'post'], 'Grupos'],
    ['/groups/{id}', ['get', 'patch', 'delete'], 'Grupos'],
    ['/groups/{id}/members', ['get', 'post'], 'Grupos'],
    ['/groups/{id}/members/{userId}', ['get', 'delete'], 'Grupos'],
    ['/tasks', ['get', 'post'], 'Tareas'],
    ['/tasks/{id}', ['get', 'patch', 'delete'], 'Tareas'],
  ]) {
    for (const method of methods) {
      assert.deepEqual(openapi.paths[path][method].tags, [tag]);
    }
  }
  assert.deepEqual(openapi.components.schemas.User.required, ['id', 'name', 'email', 'photoUrl']);

  const user = { name: ' Ana ', email: ' ANA@example.com ', password: 'clave-segura', photoUrl: 'https://example.com/foto.jpg' };
  const post = (body) => fetch(`${base}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const patch = (id, body) => fetch(`${base}/users/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const created = await post(user);
  assert.equal(created.status, 201);
  const result = await created.json();
  assert.deepEqual(Object.keys(result).sort(), ['email', 'id', 'name', 'photoUrl']);
  assert.equal(result.name, 'Ana');
  assert.equal(result.email, 'ana@example.com');
  assert.equal((await post({ ...user, email: 'ana@example.com' })).status, 409);
  assert.equal((await post({ ...user, password: 'corta' })).status, 400);
  assert.equal((await post({ ...user, photoUrl: 'file:///foto.jpg' })).status, 400);

  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  try {
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    const [algorithm, n, r, p, salt, hash] = saved.passwordHash.split('$');
    assert.equal(algorithm, 'scrypt');
    const calculated = scryptSync(user.password, Buffer.from(salt, 'hex'), 64, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    assert.equal(calculated.toString('hex'), hash);

    const firstTask = await prisma.task.create({
      data: { title: 'Primera tarea', userId: result.id },
    });
    const secondTask = await prisma.task.create({
      data: { title: 'Segunda tarea', description: 'Detalle', userId: result.id },
    });
    const userWithTasks = await prisma.user.findUniqueOrThrow({
      where: { id: result.id },
      include: { tasks: true },
    });
    assert.deepEqual(userWithTasks.tasks.map(({ id }) => id).sort(), [firstTask.id, secondTask.id].sort());
    assert.equal(firstTask.completed, false);
    assert.equal(secondTask.description, 'Detalle');

    const second = await post({ ...user, email: 'otro@example.com' });
    assert.equal(second.status, 201);
    const secondUser = await second.json();
    const taskRequest = (path, method, body) => fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createTask = (body) => taskRequest('/tasks', 'POST', body);
    const patchTask = (id, body) => taskRequest(`/tasks/${id}`, 'PATCH', body);

    const taskCreated = await createTask({ title: '  Nueva tarea  ', userId: result.id });
    assert.equal(taskCreated.status, 201);
    const task = await taskCreated.json();
    assert.deepEqual(task, {
      id: task.id, title: 'Nueva tarea', description: null, completed: false, userId: result.id,
      groupId: null, assigneeIds: [],
    });
    assert.ok(task.id);
    const otherTaskResponse = await createTask({
      title: 'Otra', description: 'Detalle', completed: true, userId: secondUser.id,
    });
    assert.equal(otherTaskResponse.status, 201);
    const otherTask = await otherTaskResponse.json();
    assert.equal(otherTask.completed, true);
    assert.equal(otherTask.description, 'Detalle');
    const listedTasks = await (await fetch(`${base}/tasks`)).json();
    assert.deepEqual(
      listedTasks.map(({ id }) => id).sort(),
      [firstTask.id, secondTask.id, task.id, otherTask.id].sort(),
    );
    const taskRead = await fetch(`${base}/tasks/${task.id}`);
    assert.equal(taskRead.status, 200);
    assert.deepEqual(await taskRead.json(), task);
    assert.equal((await fetch(`${base}/tasks/inexistente`)).status, 404);
    assert.equal((await createTask({ title: 'Tarea', userId: 'inexistente' })).status, 404);
    for (const invalid of [
      {}, { title: ' ', userId: result.id }, { title: 'Tarea' },
      { title: 'Tarea', userId: result.id, completed: 'false' },
      { title: 'Tarea', userId: result.id, description: 1 },
      { title: 'Tarea', userId: result.id, unknown: true },
      [],
    ]) {
      assert.equal((await createTask(invalid)).status, 400);
    }
    for (const invalid of [{}, { title: ' ' }, { completed: 'true' }, { userId: secondUser.id }]) {
      assert.equal((await patchTask(task.id, invalid)).status, 400);
    }
    assert.equal((await patchTask('inexistente', { title: 'Tarea' })).status, 404);
    const updatedTask = await patchTask(task.id, { title: ' Actualizada ', description: 'Detalle', completed: true });
    assert.equal(updatedTask.status, 200);
    assert.deepEqual(await updatedTask.json(), {
      ...task, title: 'Actualizada', description: 'Detalle', completed: true,
    });
    const clearedTask = await patchTask(task.id, { description: null, completed: false });
    assert.equal(clearedTask.status, 200);
    assert.deepEqual(await clearedTask.json(), { ...task, title: 'Actualizada' });
    assert.equal((await fetch(`${base}/tasks/${otherTask.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/tasks/${otherTask.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/tasks/${otherTask.id}`)).status, 404);

    const createGroup = (body) => taskRequest('/groups', 'POST', body);
    const patchGroup = (id, body) => taskRequest(`/groups/${id}`, 'PATCH', body);
    assert.equal((await createGroup({ name: ' ', memberIds: [] })).status, 400);
    assert.equal((await createGroup({ name: 'Equipo', memberIds: [result.id, result.id] })).status, 400);
    assert.equal((await createGroup({ name: 'Equipo', memberIds: ['inexistente'] })).status, 404);
    const groupCreated = await createGroup({ name: ' Equipo ', memberIds: [secondUser.id] });
    assert.equal(groupCreated.status, 201);
    const group = await groupCreated.json();
    assert.deepEqual(group, { id: group.id, name: 'Equipo', memberIds: [secondUser.id] });
    assert.deepEqual(await (await fetch(`${base}/groups/${group.id}`)).json(), group);
    assert.deepEqual(await (await fetch(`${base}/groups`)).json(), [group]);
    assert.equal((await fetch(`${base}/groups/inexistente`)).status, 404);
    assert.equal((await patchGroup('inexistente', { name: 'Equipo' })).status, 404);
    assert.equal((await patchGroup(group.id, { memberIds: ['inexistente'] })).status, 404);

    const membersPath = `/groups/${group.id}/members`;
    const addMember = (groupId, body) => taskRequest(`/groups/${groupId}/members`, 'POST', body);
    const membership = { groupId: group.id, userId: result.id };
    assert.equal((await addMember('inexistente', { userId: result.id })).status, 404);
    assert.equal((await addMember(group.id, { userId: 'inexistente' })).status, 404);
    for (const invalid of [{}, { userId: '' }, { userId: 1 }, { userId: result.id, extra: true }, []]) {
      assert.equal((await addMember(group.id, invalid)).status, 400);
    }
    const memberCreated = await addMember(group.id, { userId: result.id });
    assert.equal(memberCreated.status, 201);
    assert.deepEqual(await memberCreated.json(), membership);
    assert.equal((await addMember(group.id, { userId: result.id })).status, 409);
    assert.deepEqual(await (await fetch(`${base}${membersPath}/${result.id}`)).json(), membership);
    const members = await (await fetch(`${base}${membersPath}`)).json();
    assert.deepEqual(members.map(({ userId }) => userId), [result.id, secondUser.id].sort());
    assert.deepEqual(await (await fetch(`${base}/users/${result.id}/groups`)).json(), [{ id: group.id, name: group.name }]);
    const additionalGroup = await (await createGroup({ name: 'Segundo grupo' })).json();
    assert.equal((await addMember(additionalGroup.id, { userId: result.id })).status, 201);
    const userGroups = await (await fetch(`${base}/users/${result.id}/groups`)).json();
    assert.deepEqual(userGroups.map(({ id }) => id).sort(), [group.id, additionalGroup.id].sort());
    assert.equal((await fetch(`${base}/users/inexistente/groups`)).status, 404);
    assert.equal((await fetch(`${base}/groups/inexistente/members`)).status, 404);
    assert.equal((await fetch(`${base}${membersPath}/inexistente`)).status, 404);
    assert.equal((await fetch(`${base}${membersPath}/${result.id}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await (await fetch(`${base}/users/${result.id}/groups`)).json(), [{ id: additionalGroup.id, name: additionalGroup.name }]);
    assert.equal((await fetch(`${base}${membersPath}/${result.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/groups/${additionalGroup.id}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await (await fetch(`${base}/users/${result.id}/groups`)).json(), []);

    assert.equal((await createTask({
      title: 'Tarea', userId: result.id, groupId: 'inexistente',
    })).status, 404);
    assert.equal((await createTask({
      title: 'Tarea', userId: result.id, groupId: group.id, assigneeIds: ['inexistente'],
    })).status, 404);
    assert.equal((await createTask({
      title: 'Tarea', userId: result.id, groupId: group.id, assigneeIds: [result.id],
    })).status, 400);
    assert.equal((await createTask({
      title: 'Tarea', userId: result.id, assigneeIds: [secondUser.id, secondUser.id],
    })).status, 400);
    const groupedResponse = await createTask({
      title: 'En equipo', userId: result.id, groupId: group.id, assigneeIds: [secondUser.id],
    });
    assert.equal(groupedResponse.status, 201);
    const groupedTask = await groupedResponse.json();
    assert.equal(groupedTask.groupId, group.id);
    assert.deepEqual(groupedTask.assigneeIds, [secondUser.id]);
    const unrelatedUser = await prisma.user.create({
      data: { name: 'Otro', email: 'tercero@example.com', passwordHash: 'hash', photoUrl: 'https://example.com' },
    });
    const userTasks = (id) => fetch(`${base}/users/${id}/tasks`);
    assert.equal((await userTasks('inexistente')).status, 404);
    const emptyTasks = await userTasks(unrelatedUser.id);
    assert.equal(emptyTasks.status, 200);
    assert.deepEqual(await emptyTasks.json(), []);
    const unrelatedTask = await prisma.task.create({ data: { title: 'Ajena', userId: unrelatedUser.id } });
    const groupOnlyResponse = await createTask({ title: 'Por grupo', userId: result.id, groupId: group.id });
    assert.equal(groupOnlyResponse.status, 201);
    const groupOnlyTask = await groupOnlyResponse.json();
    const directOnlyResponse = await createTask({ title: 'Asignación directa', userId: result.id, assigneeIds: [secondUser.id] });
    assert.equal(directOnlyResponse.status, 201);
    const directOnlyTask = await directOnlyResponse.json();
    const secondUserTasksResponse = await userTasks(secondUser.id);
    assert.equal(secondUserTasksResponse.status, 200);
    const secondUserTasks = await secondUserTasksResponse.json();
    assert.deepEqual(secondUserTasks.map(({ id }) => id).sort(), [groupedTask.id, groupOnlyTask.id, directOnlyTask.id].sort());
    assert.deepEqual(secondUserTasks.find(({ id }) => id === groupOnlyTask.id), groupOnlyTask);
    const ownerTasks = await (await userTasks(result.id)).json();
    assert.deepEqual(
      ownerTasks.map(({ id }) => id).sort(),
      [firstTask.id, secondTask.id, task.id, groupedTask.id, groupOnlyTask.id, directOnlyTask.id].sort(),
    );
    assert.ok(!ownerTasks.some(({ id }) => id === unrelatedTask.id));
    await prisma.task.deleteMany({ where: { id: { in: [groupOnlyTask.id, directOnlyTask.id] } } });
    await prisma.user.delete({ where: { id: unrelatedUser.id } });
    assert.equal((await fetch(`${base}${membersPath}/${secondUser.id}`, { method: 'DELETE' })).status, 409);
    assert.deepEqual(await (await fetch(`${base}${membersPath}/${secondUser.id}`)).json(), {
      groupId: group.id, userId: secondUser.id,
    });
    assert.equal((await patchGroup(group.id, { memberIds: [] })).status, 409);
    assert.deepEqual(await (await fetch(`${base}/groups/${group.id}`)).json(), group);
    assert.equal((await patchTask(groupedTask.id, { assigneeIds: [result.id] })).status, 400);
    assert.equal((await patchTask(groupedTask.id, { groupId: 'inexistente' })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/tasks/${groupedTask.id}`)).json(), groupedTask);
    const emptyGroup = await (await createGroup({ name: 'Vacío' })).json();
    assert.equal((await patchTask(groupedTask.id, { groupId: emptyGroup.id })).status, 400);
    assert.deepEqual(await (await fetch(`${base}/tasks/${groupedTask.id}`)).json(), groupedTask);
    assert.equal((await fetch(`${base}/groups/${emptyGroup.id}`, { method: 'DELETE' })).status, 204);
    const changedGroup = await patchGroup(group.id, { name: 'Equipo dos', memberIds: [result.id, secondUser.id] });
    assert.equal(changedGroup.status, 200);
    assert.deepEqual((await changedGroup.json()).memberIds, [result.id, secondUser.id].sort());
    const updatedAssignments = await patchTask(groupedTask.id, { assigneeIds: [result.id, secondUser.id] });
    assert.equal(updatedAssignments.status, 200);
    assert.deepEqual((await updatedAssignments.json()).assigneeIds, [result.id, secondUser.id].sort());
    assert.equal((await patchTask(groupedTask.id, { assigneeIds: [secondUser.id] })).status, 200);
    assert.equal((await patchGroup(group.id, { memberIds: [secondUser.id] })).status, 200);
    const ungrouped = await patchTask(groupedTask.id, { groupId: null, assigneeIds: [result.id] });
    assert.equal(ungrouped.status, 200);
    assert.equal((await ungrouped.json()).groupId, null);
    assert.equal((await patchTask(groupedTask.id, { groupId: group.id, assigneeIds: [secondUser.id] })).status, 200);
    assert.equal((await fetch(`${base}/groups/${group.id}`, { method: 'DELETE' })).status, 204);
    const afterGroupDelete = await (await fetch(`${base}/tasks/${groupedTask.id}`)).json();
    assert.equal(afterGroupDelete.groupId, null);
    assert.equal(afterGroupDelete.userId, result.id);
    assert.deepEqual(afterGroupDelete.assigneeIds, [secondUser.id]);
    assert.equal((await fetch(`${base}/groups/${group.id}`, { method: 'DELETE' })).status, 404);
    const anotherGroup = await (await createGroup({ name: 'Otro equipo', memberIds: [secondUser.id] })).json();
    assert.equal((await patchGroup(anotherGroup.id, { memberIds: [] })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/groups/${anotherGroup.id}`)).json()).memberIds, []);
    assert.equal((await patchGroup(anotherGroup.id, { memberIds: [secondUser.id] })).status, 200);
    assert.equal((await patchTask(groupedTask.id, { groupId: anotherGroup.id })).status, 200);

    const users = await (await fetch(`${base}/users`)).json();
    assert.equal(users.length, 2);
    assert.deepEqual(Object.keys(users[0]).sort(), ['email', 'id', 'name', 'photoUrl']);
    const read = await fetch(`${base}/users/${result.id}`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), result);
    assert.equal((await fetch(`${base}/users/inexistente`)).status, 404);
    assert.equal((await patch(result.id, {})).status, 400);
    assert.equal((await patch(result.id, { passwordHash: 'no' })).status, 400);
    assert.equal((await patch(result.id, { password: 'corta' })).status, 400);
    assert.equal((await patch(result.id, { email: ' OTRO@example.com ' })).status, 409);
    assert.equal((await patch('inexistente', { name: 'Ana' })).status, 404);

    const updated = await patch(result.id, { name: ' María ', password: 'nueva-clave' });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ...result, name: 'María' });
    const afterUpdate = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    assert.notEqual(afterUpdate.passwordHash, saved.passwordHash);
    const [, newN, newR, newP, newSalt, newHash] = afterUpdate.passwordHash.split('$');
    const newCalculated = scryptSync('nueva-clave', Buffer.from(newSalt, 'hex'), 64, {
      N: Number(newN), r: Number(newR), p: Number(newP), maxmem: 64 * 1024 * 1024,
    });
    assert.equal(newCalculated.toString('hex'), newHash);

    assert.equal((await fetch(`${base}/users/${secondUser.id}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual((await (await fetch(`${base}/groups/${anotherGroup.id}`)).json()).memberIds, []);
    assert.deepEqual((await (await fetch(`${base}/tasks/${groupedTask.id}`)).json()).assigneeIds, []);
    assert.equal((await fetch(`${base}/users/${result.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/users/${result.id}`)).status, 404);
    assert.equal((await fetch(`${base}/users/${result.id}`, { method: 'DELETE' })).status, 404);
    assert.equal(await prisma.task.count({ where: { userId: result.id } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

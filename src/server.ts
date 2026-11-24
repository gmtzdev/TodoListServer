import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiDocument } from './openapi.ts';
import { groupsRouter } from './routes/groups.ts';
import { tasksRouter } from './routes/tasks.ts';
import { usersRouter } from './routes/users.ts';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/users', usersRouter);
app.use('/groups', groupsRouter);
app.use('/tasks', tasksRouter);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
app.get('/openapi.json', (_req, res) => {
  res.json(openapiDocument);
});

app.get('/health', (req, res) => {
  console.log(req.ips);
  console.log('Escuchando');
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

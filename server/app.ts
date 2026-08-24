import { Hono } from 'hono';
import { miscRoutes } from './routes/misc';

const app = new Hono().basePath('/api');

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.route('/', miscRoutes);

export default app;

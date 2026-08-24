import { Hono } from 'hono';

export const miscRoutes = new Hono().post('/report-error', async (c) => {
  let data: unknown;
  try {
    data = ((await c.req.json()) as { data?: unknown })?.data;
  } catch {
    data = undefined;
  }
  // Hook up a backend error logging service here if desired.
  console.debug('Error:', data);
  return c.body(null, 204);
});

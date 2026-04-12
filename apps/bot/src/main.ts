import express from 'express';
import { createServer } from 'http';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// LINE Webhook endpoint (placeholder — implemented in Phase 2)
app.post('/webhook', (_req, res) => {
  res.sendStatus(200);
});

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[bot] Server running on port ${PORT}`);
});

export default app;

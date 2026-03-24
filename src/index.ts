import express from 'express';
import session from 'express-session';
import PgSession from 'connect-pg-simple';
import path from 'path';
import http from 'http';
import { config } from './config';
import { getPool, migrate } from './db';
import { initWebSocket } from './websocket';
import { requireAuth, requireApiKey } from './middleware';
import authRouter from './auth';
import pagesRouter from './routes/pages';
import itemsRouter from './routes/items';
import mcpRouter from './mcp/routes';

async function main() {
  await migrate();

  const app = express();
  const server = http.createServer(app);

  // Trust reverse proxy (needed for secure cookies behind load balancers)
  app.set('trust proxy', 1);

  // Body parsing
  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  // Sessions
  const PgStore = PgSession(session);
  app.use(session({
    store: new PgStore({ pool: getPool(), tableName: 'session' }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  }));

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Auth routes (before requireAuth)
  app.use(authRouter);

  // Auth middleware for web routes
  app.use(requireAuth);

  // Static files — no cache on JS/CSS/HTML so deploys take effect immediately
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.match(/\.(js|css|html)$/)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  }));

  // API routes (session-based auth from web, or API key)
  app.use('/api/pages', pagesRouter);
  app.use('/api/items', itemsRouter);

  // MCP routes (API key auth)
  app.use('/mcp', mcpRouter);

  // SPA fallback — serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/mcp/')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // WebSocket
  initWebSocket(server);

  server.listen(config.port, () => {
    console.log(`MCliPpy running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

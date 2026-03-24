import { Request, Response, NextFunction } from 'express';
import { config } from './config';

const PUBLIC_PATHS = ['/auth/login', '/auth/google', '/auth/google/callback', '/health'];
const API_PREFIXES = ['/mcp/', '/api/'];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(req.path)) { next(); return; }

  // Skip auth for API prefixes (handled by API key middleware)
  if (API_PREFIXES.some(p => req.path.startsWith(p))) { next(); return; }

  // Skip auth for static assets
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) { next(); return; }

  // Skip auth for widget.js
  if (req.path === '/widget.js') { next(); return; }

  if ((req.session as any)?.user) {
    next();
    return;
  }

  res.redirect('/auth/login');
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const fromHeader = req.headers['x-api-key'] as string | undefined;
  const authHeader = req.headers.authorization;
  const fromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const fromQuery = req.query.apiKey as string | undefined;
  const provided = fromHeader || fromBearer || fromQuery;

  if (!provided || provided !== config.apiKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }
  next();
}

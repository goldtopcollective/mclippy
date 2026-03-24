import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { requireApiKey } from '../middleware';

const router = Router();
const transports = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();

// Streamable HTTP transport (2025-11-25 protocol)
router.all('/stream', requireApiKey, async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await (transport as StreamableHTTPServerTransport).handleRequest(req, res, req.body);
    return;
  }

  // New session
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      transports.set(sid, transport);
    },
  });

  transport.onclose = () => {
    const sid = [...transports.entries()].find(([, t]) => t === transport)?.[0];
    if (sid) transports.delete(sid);
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// SSE transport (2024-11-05 protocol, for backwards compat)
router.get('/sse', requireApiKey, async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports.set(transport.sessionId, transport);

  res.on('close', () => {
    transports.delete(transport.sessionId);
  });

  const server = createMcpServer();
  await server.connect(transport);
});

router.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport || !(transport instanceof SSEServerTransport)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

export default router;

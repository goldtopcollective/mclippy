# MCliPpy

A shared clipboard with MCP integration. Paste text, images, and files from any device and access them instantly from Claude Code (or any MCP client) — and vice versa.

## What it does

- **Shared clipboard** — paste, drag-and-drop, or upload text (markdown), images, and file attachments
- **Real-time sync** — WebSocket-powered, changes appear instantly on all connected devices
- **MCP server** — Claude Code (or any MCP-compatible client) can read, push, and manage clipboard items
- **Shared selection** — select items in the browser and the MCP client sees what's selected (and vice versa), so you can say "the ones I'm selecting now"
- **Named pages** — organise items by client, project, or topic
- **Embeddable widget** — drop `widget.js` into any page for a quick upload zone

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_pages` | List all clipboard pages |
| `get_page` | Get all items on a page |
| `get_selected` | Get currently selected items |
| `push_text` | Push text/markdown to the clipboard |
| `push_image` | Push a base64 image |
| `push_file` | Push a file attachment |
| `remove_item` | Delete an item |
| `select_item` | Select items (visible to all clients) |
| `deselect_item` | Deselect items |
| `create_page` | Create a new page |

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL
- A Google OAuth 2.0 client (for login)

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL (`https://your-domain.com/auth/google/callback`) |
| `ALLOWED_ADMIN_EMAILS` | Yes | Comma-separated Google email addresses allowed to log in |
| `MCLIPPY_API_KEY` | Yes | API key for MCP and widget access |
| `SESSION_SECRET` | Yes | Random string for session encryption |
| `PUBLIC_URL` | No | Public URL (defaults to `http://localhost:3000`) |
| `PORT` | No | Server port (defaults to `3000`) |

### Run locally

```bash
npm install --include=dev
npm run build
npm start
```

### Deploy

MCliPpy is a standard Node.js app with a Dockerfile. It works on any platform that supports Docker or Node.js — Railway, Fly.io, Render, a VPS, etc.

1. Create a PostgreSQL database
2. Set up a Google OAuth 2.0 client in Google Cloud Console with the redirect URI pointing to your deployment
3. Generate an API key (e.g. `openssl rand -hex 24`)
4. Set the environment variables listed above
5. Deploy

The database schema is created automatically on first start.

### Connect to Claude Code

Add MCliPpy as an SSE MCP server in your Claude Code config (`~/.claude.json` or project settings):

```json
{
  "mcpServers": {
    "mclippy": {
      "type": "sse",
      "url": "https://your-domain.com/mcp/sse?apiKey=YOUR_API_KEY"
    }
  }
}
```

MCP authentication supports:
- Query parameter: `?apiKey=YOUR_KEY`
- Header: `X-API-Key: YOUR_KEY`
- Header: `Authorization: Bearer YOUR_KEY`

### Embeddable Widget

Add the clipboard upload zone to any page:

```html
<script src="https://your-domain.com/widget.js"
        data-api-key="YOUR_API_KEY"
        data-page="general"></script>
```

Or initialise programmatically:

```js
MCliPpy.init({ apiKey: 'YOUR_KEY', page: 'general', target: '#my-container' });
```

## Architecture

- **Backend**: Express + PostgreSQL + WebSocket
- **Frontend**: Vanilla JS SPA with drag-and-drop, markdown rendering (marked.js), image lightbox
- **MCP**: SSE and Streamable HTTP transports via `@modelcontextprotocol/sdk`
- **Auth**: Google OAuth for the web UI, API key for MCP/widget
- **Build**: esbuild (fast, low memory footprint)

## License

MIT

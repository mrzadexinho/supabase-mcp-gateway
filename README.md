# Supabase MCP Gateway

Supergateway wrapper for [selfhosted-supabase-mcp](https://github.com/HenkDz/selfhosted-supabase-mcp) - exposes the stdio-based MCP server over SSE/HTTP for remote access.

## Architecture

```
Claude.ai / Claude Code
        ↓ (HTTPS)
https://mcp-supabase.yourdomain.com/sse
        ↓ (Traefik / Reverse Proxy)
Supergateway (this container)
        ↓ (spawns stdio subprocess)
selfhosted-supabase-mcp
        ↓ (PostgreSQL connection)
Supabase Database
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g., `https://supabase.yourdomain.com`) |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `DATABASE_URL` | Yes | Direct PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |

## Deployment (Coolify)

1. Create new application from this Git repository
2. Set environment variables
3. Configure domain (e.g., `mcp-supabase.yourdomain.com`)
4. Set port to `3000`
5. Deploy

### Important: Docker Network

The container must be on the **same Docker network** as your Supabase stack to resolve the database hostname.

For `DATABASE_URL`, use the internal container hostname:
```
postgresql://postgres:PASSWORD@supabase-db-CONTAINER_ID:5432/postgres
```

## Endpoints

- `GET /sse` - SSE subscription endpoint
- `POST /message` - Message endpoint for MCP commands

## Usage with Claude.ai

Add as MCP server with SSE transport:
```
URL: https://mcp-supabase.yourdomain.com/sse
```

## Usage with Claude Code

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "supergateway",
        "--sse",
        "https://mcp-supabase.yourdomain.com/sse"
      ]
    }
  }
}
```

## Security

Recommended: Enable HTTP Basic Auth or API key authentication at your reverse proxy level (Traefik/Nginx).

## License

MIT

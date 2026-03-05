# Supabase MCP Gateway

> Expose your self-hosted Supabase as an MCP server for Claude Code, Claude.ai, and other MCP clients.

Wraps [selfhosted-supabase-mcp](https://github.com/HenkDz/selfhosted-supabase-mcp) (v1.3.0) with [Supergateway](https://github.com/nichochar/supergateway) to bridge the stdio-based MCP server to SSE/HTTP transport.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Claude Code (local machine)                                 │
│  └── mcp-sse-bridge.mjs (stdio ↔ SSE)                       │
│          ↓ HTTPS                                             │
├──────────────────────────────────────────────────────────────┤
│  Cloudflare DNS (DNS only — no proxy)                        │
│  mcp-supabase.yourdomain.com → VPS public IP                 │
│          ↓                                                   │
├──────────────────────────────────────────────────────────────┤
│  VPS                                                         │
│  ├── Traefik (TLS termination, Let's Encrypt)                │
│  │       ↓ HTTP                                              │
│  ├── Supergateway (this container, port 3000)                │
│  │   ├── GET  /sse      → SSE subscription                  │
│  │   ├── POST /message  → JSON-RPC messages                 │
│  │   └── GET  /health   → health check                      │
│  │       ↓ stdio                                             │
│  └── selfhosted-supabase-mcp                                 │
│          ↓ PostgreSQL                                        │
│      Supabase Database                                       │
└──────────────────────────────────────────────────────────────┘
```

## Available Tools (41+)

| Category | Tools |
|----------|-------|
| **Database** | `execute_sql`, `list_tables`, `list_table_columns`, `list_extensions`, `explain_query` |
| **Schema** | `list_indexes`, `list_constraints`, `list_foreign_keys`, `list_triggers`, `get_function_definition` |
| **Migrations** | `apply_migration`, `list_migrations` |
| **Security** | `list_rls_policies`, `get_rls_status`, `get_advisors` (security/performance) |
| **Auth** | `list_auth_users`, `get_auth_user`, `create_auth_user`, `update_auth_user`, `delete_auth_user` |
| **Storage** | `list_storage_buckets`, `list_storage_objects`, `get_storage_config`, `update_storage_config` |
| **Functions** | `list_database_functions`, `get_function_definition`, `list_edge_functions`, `get_edge_function_details` |
| **Monitoring** | `get_logs`, `get_database_connections`, `get_database_stats`, `get_index_stats` |
| **Vectors** | `list_vector_indexes`, `get_vector_index_stats` |
| **Cron** | `list_cron_jobs`, `get_cron_job_history` |
| **Other** | `get_project_url`, `verify_jwt_secret`, `rebuild_hooks`, `generate_typescript_types` |

## Prerequisites

- Self-hosted Supabase instance (managed by Coolify, Docker Compose, etc.)
- VPS with a reverse proxy (Traefik, Nginx, Caddy) for TLS
- DNS record pointing to your VPS (Cloudflare recommended)
- Node.js 18+ on your local machine (for Claude Code bridge)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g., `https://supabase.yourdomain.com`) |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous/publishable key (JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (JWT) |
| `DATABASE_URL` | Yes | Direct PostgreSQL connection string |
| `PORT` | No | Server port (default: `3000`) |

### Database URL

The container must be on the **same Docker network** as your Supabase stack. Use the internal container hostname for `DATABASE_URL`:

```
postgresql://postgres:YOUR_PASSWORD@supabase-db-CONTAINER_ID:5432/postgres
```

Find the container hostname with:
```bash
docker ps --filter "name=supabase-db" --format "{{.Names}}"
```

## Deployment

### Option 1: Coolify (Recommended)

1. Create a new application from this Git repository
2. Set the environment variables (see above)
3. Configure domain: `mcp-supabase.yourdomain.com`
4. Set exposed port to `3000`
5. **Important**: Disable Basic Auth if enabled (it blocks MCP clients)
6. Deploy

### Option 2: Docker Compose

```yaml
services:
  supabase-mcp:
    build: .
    ports:
      - "3000:3000"
    environment:
      SUPABASE_URL: https://supabase.yourdomain.com
      SUPABASE_ANON_KEY: eyJ...
      SUPABASE_SERVICE_ROLE_KEY: eyJ...
      DATABASE_URL: postgresql://postgres:PASSWORD@supabase-db:5432/postgres
    networks:
      - your-supabase-network

networks:
  your-supabase-network:
    external: true
```

### Option 3: Docker Run

```bash
docker build -t supabase-mcp-gateway .
docker run -d \
  --name supabase-mcp \
  --network your-supabase-network \
  -p 3000:3000 \
  -e SUPABASE_URL=https://supabase.yourdomain.com \
  -e SUPABASE_ANON_KEY=eyJ... \
  -e SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  -e DATABASE_URL=postgresql://postgres:PASSWORD@supabase-db:5432/postgres \
  supabase-mcp-gateway
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sse` | SSE subscription — returns `event: endpoint` with session-specific message URL |
| `POST` | `/message?sessionId=...` | Send JSON-RPC messages (MCP protocol) |
| `GET` | `/health` | Health check — returns `ok` |

## DNS & TLS Setup

### Cloudflare (Recommended)

Create an A record pointing to your VPS public IP:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `mcp-supabase` | `YOUR_VPS_IP` | **DNS only** (grey cloud) |

**Important**: Cloudflare proxy (orange cloud) **must be disabled**. Cloudflare buffers Server-Sent Events, which breaks the SSE streaming required by MCP.

### TLS

With Cloudflare proxy off, your reverse proxy handles TLS:
- **Traefik**: Use `certresolver=letsencrypt` (Coolify configures this automatically)
- **Nginx**: Use certbot
- **Caddy**: Automatic HTTPS

## Client Configuration

### Claude Code

Claude Code's built-in SSE client has a known issue: it performs a 10-second OAuth discovery probe before connecting, which causes timeouts against servers that don't implement OAuth.

**Solution**: Use the included stdio-to-SSE bridge script.

#### 1. Install the bridge

```bash
# Copy the bridge script to your Claude config directory
cp mcp-sse-bridge.mjs ~/.claude/mcp-sse-bridge.mjs
```

Or create `~/.claude/mcp-sse-bridge.mjs` with the contents from this repo.

#### 2. Configure Claude Code

```bash
claude mcp add supabase-vps -s user -- \
  node ~/.claude/mcp-sse-bridge.mjs \
  https://mcp-supabase.yourdomain.com/sse
```

#### 3. Verify

```bash
claude mcp list
# Should show: supabase-vps: ... - ✓ Connected
```

#### Alternative: Project-level config

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "supabase-vps": {
      "command": "node",
      "args": [
        "/path/to/.claude/mcp-sse-bridge.mjs",
        "https://mcp-supabase.yourdomain.com/sse"
      ]
    }
  }
}
```

### Claude.ai (Desktop/Web)

Add as an MCP server with SSE transport:

```
URL: https://mcp-supabase.yourdomain.com/sse
```

### Other MCP Clients

Any MCP client that supports SSE transport can connect directly:

```
SSE endpoint: https://mcp-supabase.yourdomain.com/sse
Message endpoint: https://mcp-supabase.yourdomain.com/message
```

## How the Bridge Works

```
Claude Code ←→ stdio ←→ mcp-sse-bridge.mjs ←→ HTTPS/SSE ←→ Supergateway ←→ stdio ←→ selfhosted-supabase-mcp
```

The bridge (`mcp-sse-bridge.mjs`):
1. Opens an SSE connection to the gateway
2. Receives a session-specific `/message?sessionId=...` endpoint
3. Reads JSON-RPC messages from stdin, POSTs them to the message endpoint
4. Receives JSON-RPC responses via SSE `message` events, writes them to stdout
5. Auto-reconnects on disconnection

It avoids the OAuth discovery overhead that makes `mcp-remote` and Claude Code's native SSE client slow/unreliable.

## Troubleshooting

### `claude mcp list` shows "Failed to connect"

**Cause**: Claude Code's SSE client spends 10s on OAuth discovery before trying to connect.

**Fix**: Use the stdio bridge instead of direct SSE. See [Claude Code configuration](#claude-code) above.

### Health endpoint returns 401

**Cause**: Reverse proxy has Basic Auth enabled.

**Fix (Coolify)**: The basic auth is stored in the Coolify database as Traefik labels. To remove it:
1. Check current labels: `docker inspect CONTAINER --format '{{json .Config.Labels}}' | grep basic`
2. Remove the `basicauth` middleware from Traefik labels in the Coolify-generated `docker-compose.yaml`
3. Update the HTTPS router's `middlewares` label to exclude `http-basic-auth-*`
4. Recreate the container: `docker compose up -d --force-recreate`
5. Update Coolify's database so the change persists across redeploys:
   ```sql
   -- In coolify-db container
   -- Decode custom_labels, remove basic auth lines, re-encode, UPDATE
   ```

### SSE returns no data through Cloudflare

**Cause**: Cloudflare's proxy buffers SSE responses.

**Fix**: Set the DNS record to **DNS only** (grey cloud icon, not orange). The SSE streaming protocol requires unbuffered responses.

### Container crashes with `__require is not a function`

**Cause**: The MCP server was built with `--target bun` but runs on Node.js.

**Fix**: The Dockerfile uses `bun build src/index.ts --outdir dist --target node`. If you modify the build, ensure `--target node` is set.

### Container can't connect to database

**Cause**: Container is not on the same Docker network as the Supabase stack.

**Fix**: Ensure the container joins the correct network (e.g., `coolify` network in Coolify deployments). Verify with:
```bash
docker exec CONTAINER node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { console.log('OK'); c.end(); }).catch(e => console.error(e.message));
"
```

### `mcp-remote` hangs for 10+ seconds

**Cause**: `mcp-remote` performs OAuth discovery (probe + `.well-known/` lookups) before connecting. The initial probe times out after 10s because the SSE endpoint streams instead of returning.

**Fix**: Use `mcp-sse-bridge.mjs` instead. It connects in < 1 second.

## Security Considerations

- The MCP server has full database access via the service role key
- Restrict access at the network/reverse proxy level (IP allowlisting, VPN, etc.)
- The bridge script connects over HTTPS — all traffic is encrypted
- Consider adding authentication at the Traefik level for production use (API key header, mTLS)
- Do **not** expose the service without TLS

## License

MIT

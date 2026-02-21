# Stage 1: Build the Supabase MCP server using Bun
FROM oven/bun:latest AS builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Clone and build selfhosted-supabase-mcp
RUN git clone https://github.com/HenkDz/selfhosted-supabase-mcp /app
WORKDIR /app
RUN bun install && bun run build

# Stage 2: Supergateway with MCP server
FROM supercorp/supergateway:latest

# Copy built MCP server from builder (includes node_modules + dist)
COPY --from=builder /app /app/supabase-mcp

# Default port
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Entrypoint - Supergateway wrapping the MCP server
ENTRYPOINT ["sh", "-c", "npx supergateway --stdio \"node /app/supabase-mcp/dist/index.js --url $SUPABASE_URL --anon-key $SUPABASE_ANON_KEY --service-key $SUPABASE_SERVICE_ROLE_KEY --db-url $DATABASE_URL\" --port $PORT --ssePath /sse --messagePath /message --healthEndpoint /health"]

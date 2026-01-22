# Stage 1: Build the Supabase MCP server
FROM node:lts-alpine AS builder

RUN apk add --no-cache git

# Clone and build selfhosted-supabase-mcp
RUN git clone https://github.com/HenkDz/selfhosted-supabase-mcp /app
WORKDIR /app
RUN npm install && npm run build

# Stage 2: Supergateway with MCP server
FROM supercorp/supergateway:latest

# Copy built MCP server from builder
COPY --from=builder /app /app/supabase-mcp

# Default port
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Entrypoint - Supergateway wrapping the MCP server
# Added --healthEndpoint for proxy health checks
ENTRYPOINT ["sh", "-c", "npx supergateway --stdio \"node /app/supabase-mcp/dist/index.js --url $SUPABASE_URL --anon-key $SUPABASE_ANON_KEY --service-key $SUPABASE_SERVICE_ROLE_KEY --db-url $DATABASE_URL\" --port $PORT --ssePath /sse --messagePath /message --healthEndpoint /health"]

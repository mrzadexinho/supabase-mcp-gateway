#!/usr/bin/env node
/**
 * MCP SSE Bridge — stdio-to-SSE transport for MCP servers
 *
 * Bridges Claude Code's stdio protocol to a remote Supergateway SSE endpoint.
 * Avoids the 10-second OAuth discovery timeout that plagues `mcp-remote` and
 * Claude Code's native SSE client against servers without OAuth.
 *
 * Usage:
 *   node mcp-sse-bridge.mjs <sse-url>
 *
 * Example:
 *   node mcp-sse-bridge.mjs https://mcp-supabase.yourdomain.com/sse
 *
 * Claude Code config (~/.claude.json or .mcp.json):
 *   {
 *     "mcpServers": {
 *       "supabase-vps": {
 *         "command": "node",
 *         "args": ["~/.claude/mcp-sse-bridge.mjs", "https://mcp-supabase.yourdomain.com/sse"]
 *       }
 *     }
 *   }
 *
 * Protocol flow:
 *   1. Opens GET /sse → receives `event: endpoint` with session-specific message path
 *   2. Reads JSON-RPC from stdin → POSTs to /message?sessionId=...
 *   3. Receives JSON-RPC via SSE `event: message` → writes to stdout
 *   4. Auto-reconnects on disconnect
 */

import http from "node:http";
import https from "node:https";

const SSE_URL = process.argv[2];
if (!SSE_URL) {
  process.stderr.write("Usage: node mcp-sse-bridge.mjs <sse-url>\n");
  process.exit(1);
}

const url = new URL(SSE_URL);
const client = url.protocol === "https:" ? https : http;
const baseUrl = `${url.protocol}//${url.host}`;

let messageUrl = null;
let buffer = "";

// --- stdin: Read JSON-RPC messages and POST to server ---

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (line) {
      sendMessage(line);
    }
  }
});

function sendMessage(jsonStr) {
  if (!messageUrl) {
    process.stderr.write("[bridge] No message URL yet, queuing...\n");
    setTimeout(() => sendMessage(jsonStr), 500);
    return;
  }

  const msgUrl = new URL(messageUrl, baseUrl);
  const opts = {
    method: "POST",
    hostname: msgUrl.hostname,
    port: msgUrl.port || (msgUrl.protocol === "https:" ? 443 : 80),
    path: msgUrl.pathname + msgUrl.search,
    headers: { "Content-Type": "application/json" },
  };

  const req = (msgUrl.protocol === "https:" ? https : http).request(
    opts,
    (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200 && res.statusCode !== 202) {
          process.stderr.write(
            `[bridge] POST ${res.statusCode}: ${body}\n`
          );
        }
      });
    }
  );
  req.on("error", (e) =>
    process.stderr.write(`[bridge] POST error: ${e.message}\n`)
  );
  req.write(jsonStr);
  req.end();
}

// --- SSE: Connect and stream responses to stdout ---

function connectSSE() {
  process.stderr.write(`[bridge] Connecting to ${SSE_URL}\n`);

  const req = client.get(
    SSE_URL,
    { headers: { Accept: "text/event-stream" } },
    (res) => {
      if (res.statusCode !== 200) {
        process.stderr.write(`[bridge] SSE returned ${res.statusCode}\n`);
        process.exit(1);
      }

      process.stderr.write("[bridge] SSE connected\n");
      let sseBuf = "";
      let currentEvent = "";

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        sseBuf += chunk;
        let nlIdx;
        while ((nlIdx = sseBuf.indexOf("\n")) !== -1) {
          const line = sseBuf.slice(0, nlIdx).trimEnd();
          sseBuf = sseBuf.slice(nlIdx + 1);

          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (currentEvent === "endpoint") {
              messageUrl = data;
              process.stderr.write(
                `[bridge] Message endpoint: ${messageUrl}\n`
              );
            } else if (currentEvent === "message") {
              // Forward MCP response to stdout
              process.stdout.write(data + "\n");
            }
            currentEvent = "";
          }
        }
      });

      res.on("end", () => {
        process.stderr.write("[bridge] SSE disconnected, reconnecting...\n");
        messageUrl = null;
        setTimeout(connectSSE, 1000);
      });

      res.on("error", (e) => {
        process.stderr.write(`[bridge] SSE error: ${e.message}\n`);
        messageUrl = null;
        setTimeout(connectSSE, 2000);
      });
    }
  );

  req.on("error", (e) => {
    process.stderr.write(`[bridge] Connection error: ${e.message}\n`);
    setTimeout(connectSSE, 2000);
  });
}

connectSSE();

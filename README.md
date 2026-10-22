# Trustcase MCP server

A small, read-only MCP server that lets AI tools like Cursor and Claude search the Trustcase directory of practical AI agent use cases. Every result links back to https://trustcase.dev.

Published on npm as `trustcase-mcp`. Install with `npx -y trustcase-mcp`.

## Tools

| Tool | What it does |
|---|---|
| `search_use_cases` | Search by words, with optional `category`, `min_trust_score` and `limit` (max 25). Returns title, category, summary, trust score and the trustcase.dev link. |
| `get_use_case` | Full entry by `slug`: what the agent does alone, what waits for a human yes, trust score breakdown, setup prompt, tools, models, where it runs, and the link. |

Both tools are marked read-only. The server never writes anything anywhere.

## Data source

It reads the public feed at `https://trustcase.dev/api/use-cases.json` (cached for 1 hour). Point it somewhere else with `TRUSTCASE_FEED_URL`, which also accepts a local file path. `test/feed.json` is a snapshot built from the Trustcase repo (97 use cases).

## Build and test

```bash
npm install
npm run build
npm test          # end to end over stdio and streamable HTTP against test/feed.json
```

## Use it in Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "trustcase": {
      "command": "node",
      "args": ["/absolute/path/to/trustcase-mcp/dist/index.js"]
    }
  }
}
```

Once it is on npm this becomes `"command": "npx", "args": ["-y", "trustcase-mcp"]`.

## Use it in Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "trustcase": {
      "command": "node",
      "args": ["/absolute/path/to/trustcase-mcp/dist/index.js"],
      "env": { "TRUSTCASE_FEED_URL": "https://trustcase.dev/api/use-cases.json" }
    }
  }
}
```

Restart Claude Desktop, then ask something like "Find a Trustcase use case for invoice follow ups with a trust score over 80."

## Remote (streamable HTTP)

```bash
PORT=8787 node dist/index.js      # or: node dist/index.js --http
```

The endpoint is `http://localhost:8787/mcp` (stateless, POST). A hosted copy could live at something like `https://mcp.trustcase.dev/mcp` later.

## Claude Code

```bash
claude mcp add trustcase -- node /absolute/path/to/trustcase-mcp/dist/index.js
```

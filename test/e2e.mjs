import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import assert from "node:assert";
const feed = new URL("./feed.json", import.meta.url).pathname;
async function run(label, transport) {
  const c = new Client({ name: "e2e", version: "1" }); await c.connect(transport);
  const tools = (await c.listTools()).tools.map((t) => t.name);
  console.log(`[${label}] tools:`, tools.join(", "));
  assert.deepEqual(tools.sort(), ["get_use_case", "search_use_cases"]);
  const s = await c.callTool({ name: "search_use_cases", arguments: { query: "ebay listing", limit: 3 } });
  console.log(`[${label}] search_use_cases('ebay listing'):\n` + s.content[0].text);
  const r = s.structuredContent.results; assert(r.every((x) => x.category === "Ecommerce and resale"), "ebay ranking"); assert(r.length > 0 && r.every((x) => x.url.startsWith("https://trustcase.dev/use-cases/")));
  const f = await c.callTool({ name: "search_use_cases", arguments: { category: "Sales", min_trust_score: 80 } });
  assert(f.structuredContent.results.every((x) => x.category === "Sales" && x.trustScore >= 80));
  const g = await c.callTool({ name: "get_use_case", arguments: { slug: r[0].slug } });
  console.log(`[${label}] get_use_case('${r[0].slug}') first lines:\n` + g.content[0].text.split("\n").slice(0, 6).join("\n") + "\n   ...\n" + g.content[0].text.split("\n").slice(-1)[0]);
  assert(g.content[0].text.includes("Setup prompt:") && g.content[0].text.includes("https://trustcase.dev/use-cases/"));
  const bad = await c.callTool({ name: "get_use_case", arguments: { slug: "nope" } }); assert(bad.isError);
  await c.close(); console.log(`[${label}] PASS`);
}
await run("stdio", new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, TRUSTCASE_FEED_URL: feed } }));
const p = spawn("node", ["dist/index.js", "--http"], { env: { ...process.env, PORT: "8799", TRUSTCASE_FEED_URL: feed } });
await new Promise((ok) => p.stderr.once("data", ok));
try { await run("http", new StreamableHTTPClientTransport(new URL("http://localhost:8799/mcp"))); } finally { p.kill(); }

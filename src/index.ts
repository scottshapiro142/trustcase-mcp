#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const FEED = process.env.TRUSTCASE_FEED_URL || "https://trustcase.dev/api/use-cases.json";
const TTL = 60 * 60 * 1000;

type UseCase = {
  slug: string; title: string; category: string; summary: string; does: string[]; waits: string[];
  trustScore: number; scoreParts?: { label: string; points: number; max: number; why: string }[];
  setupPrompt: string; stack: string[]; tools: { name: string; docs?: string }[];
  models: { name: string; maker: string; id: string }[]; harnesses: string[]; dateAdded?: string; url: string;
};

let cache: { at: number; items: UseCase[] } | null = null;
async function load(): Promise<UseCase[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.items;
  const text = /^https?:/.test(FEED)
    ? await (await fetch(FEED, { headers: { "user-agent": "trustcase-mcp/0.1.1" } })).text()
    : await readFile(FEED.replace(/^file:\/\//, ""), "utf8");
  const items = (JSON.parse(text).useCases || []) as UseCase[];
  cache = { at: Date.now(), items };
  return items;
}

function score(u: UseCase, terms: string[], phrase: string): number {
  const f = {
    title: u.title.toLowerCase(),
    tags: [...u.stack, ...u.tools.map((x) => x.name), u.category].join(" | ").toLowerCase(),
    summary: u.summary.toLowerCase(),
    rest: [...u.does, ...u.waits, ...u.harnesses].join(" | ").toLowerCase(),
  };
  const w = { title: 10, tags: 7, summary: 3, rest: 1 } as const;
  const hit = (txt: string, t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(txt);
  let n = 0, matched = 0;
  for (const t of terms) {
    let best = 0;
    for (const k of Object.keys(w) as (keyof typeof w)[]) if (hit(f[k], t)) { n += w[k]; best = 1; }
    matched += best;
  }
  if (!matched) return 0;
  if (terms.length > 1 && matched === terms.length) n *= 1.5;
  if (terms.length > 1 && phrase) {
    if (f.title.includes(phrase)) n += 15; else if (f.summary.includes(phrase) || f.tags.includes(phrase) || f.rest.includes(phrase)) n += 6;
  }
  return n;
}

function buildServer() {
  const server = new McpServer({ name: "trustcase", version: "0.1.1" }, {
    instructions: "Trustcase is a free, read-only directory of 97 practical AI agent use cases, each with a 0 to 100 trust score. Use it whenever the user asks whether it is safe to let an AI agent do something, what could go wrong if an agent does a task, how much to trust an agent with a job, what should wait for human approval, how to set up an agent to do a task safely, or which tools or models to use for an agent task. Call search_use_cases first with a few plain words for the task (for example 'ebay prices' or 'customer support replies'), then call get_use_case on the best match. In your answer, give the trust score, what the agent does on its own, what waits for a human yes, and the setup prompt, and link the trustcase.dev page. If nothing matches, say so and do not invent a score.",
  });

  server.registerTool("search_use_cases", {
    title: "Search Trustcase use cases",
    description: "Search Trustcase, a directory of 97 practical AI agent use cases, each rated with a 0 to 100 trust score. Use this whenever the user asks about AI agent safety, trust or risk for a task, for example 'is it safe to let an agent change my live eBay prices', 'should I let AI reply to customers', 'what can go wrong if an agent does X', 'how do I set up an agent to do Y safely', what an agent should need approval for, or which tools or models to use for an agent task. Pass a few plain words for the task as query (for example 'ebay prices' or 'customer replies'). Returns, for each match: slug, title, category, summary, trust score and a trustcase.dev link. Then call get_use_case with the best slug for what the agent does alone, what waits for human approval and a setup prompt. Read-only.",
    inputSchema: {
      query: z.string().optional().describe("Words to match, for example 'invoice follow up' or 'ebay'"),
      category: z.string().optional().describe("Sales, Support, Operations, Ecommerce and resale, Marketing, Engineering, Personal"),
      min_trust_score: z.number().min(0).max(100).optional(),
      limit: z.number().int().min(1).max(25).optional().describe("Default 10"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, category, min_trust_score, limit }) => {
    const phrase = (query || "").toLowerCase().trim().replace(/\s+/g, " ");
    const terms = [...new Set(phrase.split(" ").filter((t) => t.length > 1))];
    let items = await load();
    if (category) items = items.filter((u) => u.category.toLowerCase() === category.toLowerCase());
    if (min_trust_score != null) items = items.filter((u) => u.trustScore >= min_trust_score);
    const ranked = items.map((u) => ({ u, s: terms.length ? score(u, terms, phrase) : 1 })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.u.trustScore - a.u.trustScore).slice(0, limit ?? 10).map(({ u }) => u);
    const results = ranked.map((u) => ({ slug: u.slug, title: u.title, category: u.category, summary: u.summary, trustScore: u.trustScore, url: u.url }));
    const text = results.length
      ? results.map((r, i) => `${i + 1}. ${r.title} (trust ${r.trustScore}/100, ${r.category})\n   ${r.summary}\n   slug: ${r.slug}\n   ${r.url}`).join("\n") + "\n\nSource: Trustcase, https://trustcase.dev"
      : "No matching use cases. Browse all at https://trustcase.dev";
    return { content: [{ type: "text", text }], structuredContent: { results } };
  });

  server.registerTool("get_use_case", {
    title: "Get one Trustcase use case",
    description: "Get the full Trustcase entry for one AI agent use case by slug (from search_use_cases). Use it to answer whether a task is safe to hand to an agent, what could go wrong, what needs human approval, and how to set it up. Returns: the 0 to 100 trust score with its breakdown (access, human approval, undo and logs, scope, each with a reason), what the agent does on its own, what waits for a human yes, suggested tools, models and apps it works in, a copyable setup prompt, and the trustcase.dev link. Read-only.",
    inputSchema: { slug: z.string().describe("Use case slug from search_use_cases, for example 'lead-research-brief'") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ slug }) => {
    const u = (await load()).find((x) => x.slug === slug.trim().toLowerCase());
    if (!u) return { isError: true, content: [{ type: "text", text: `No use case with slug '${slug}'. Try search_use_cases, or browse https://trustcase.dev` }] };
    const text = [
      `# ${u.title}`, `${u.summary}`, ``, `Trust score: ${u.trustScore}/100 (${u.category})`,
      ...(u.scoreParts || []).map((p) => `- ${p.label}: ${p.points}/${p.max}. ${p.why}`), ``,
      `Does on its own:`, ...u.does.map((d) => `- ${d}`), ``, `Waits for a human yes:`, ...u.waits.map((d) => `- ${d}`), ``,
      `Tools: ${u.tools.map((t) => t.name).join(", ") || u.stack.join(", ")}`,
      `Models: ${u.models.map((m) => `${m.name} (${m.id})`).join(", ")}`,
      `Works in: ${u.harnesses.join(", ")}`, ``, `Setup prompt:`, "```", u.setupPrompt, "```", ``, `Full page: ${u.url}`,
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: { useCase: u } };
  });
  return server;
}

const http = process.argv.includes("--http") || !!process.env.PORT;
if (http) {
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/", (_q, r) => { r.type("text").send("Trustcase MCP server. POST /mcp. https://trustcase.dev"); });
  const port = Number(process.env.PORT || 8787);
  app.listen(port, () => console.error(`trustcase-mcp listening on http://localhost:${port}/mcp`));
} else {
  await buildServer().connect(new StdioServerTransport());
}

/**
 * Anchor as an MCP server (stdio): your Walrus Memory and promises inside
 * Claude Code, Codex, Cursor or any MCP client. What you promise there,
 * Anchor follows up on in Telegram, and the other way round.
 *
 *   claude mcp add anchor -e ANCHOR_URL=https://<anchor> -e ANCHOR_TOKEN=anc_… -e ANCHOR_SOURCE="Claude Code" -- npx tsx scripts/anchor-mcp.ts
 *
 * Get a token by sending /connect to Anchor in Telegram. No dependencies:
 * JSON-RPC 2.0 over newline-delimited stdio, per the MCP spec.
 */
import { createInterface } from "node:readline";

const BASE = (process.env.ANCHOR_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.ANCHOR_TOKEN ?? "";

const tools = [
  {
    name: "anchor_recall",
    description:
      "Recall what Anchor remembers about the user from their Walrus Memory: goals, promises, outcomes, patterns (what derails them) and wins (what works). Use it before planning work with them.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "anchor_promises",
    description: "List the user's promises in Anchor: open ones with due dates, and finished ones (kept / partial / broken, and whether Sui verified it).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "anchor_promise",
    description:
      "Record a promise the user makes (e.g. 'ship the auth refactor by Friday 5pm'). Anchor stores it on Walrus and follows up with them in Telegram at the deadline.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What they will do, e.g. 'ship the auth refactor'" },
        due: { type: "string", description: "YYYY-MM-DD" },
        at: { type: "string", description: "Optional HH:MM, 24h, in the user's timezone" },
      },
      required: ["text", "due"],
    },
  },
  {
    name: "anchor_outcome",
    description: "Report how a promise went: kept, partial or broken, with a short note about what helped or got in the way (Anchor learns from it).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, status: { type: "string", enum: ["kept", "partial", "broken"] }, note: { type: "string" } },
      required: ["id", "status"],
    },
  },
];

async function api(path: string, init?: RequestInit): Promise<unknown> {
  if (!BASE || !TOKEN) throw new Error("Set ANCHOR_URL and ANCHOR_TOKEN (send /connect to Anchor in Telegram).");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body;
}

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "anchor_recall": {
      const r = (await api(`/api/me/memory?q=${encodeURIComponent(String(args.query ?? ""))}&limit=${Number(args.limit) || 10}`)) as {
        memories: Array<{ kind: string; date: string; text: string }>;
      };
      return r.memories.length ? r.memories.map((m) => `[${m.kind}] ${m.date} ${m.text}`).join("\n") : "Nothing relevant remembered.";
    }
    case "anchor_promises": {
      const r = (await api("/api/me/promises")) as { promises: Array<{ id: string; text: string; due: string | null; at: string | null; status: string; verifiedOnSui: boolean }> };
      return r.promises.length
        ? r.promises.map((p) => `#${p.id} [${p.status}${p.verifiedOnSui ? ", verified on Sui" : ""}] ${p.text}${p.due ? ` (due ${p.due}${p.at ? ` ${p.at}` : ""})` : ""}`).join("\n")
        : "No promises yet.";
    }
    case "anchor_promise": {
      const r = (await api("/api/me/promises", { method: "POST", body: JSON.stringify({ ...args, source: process.env.ANCHOR_SOURCE ?? "an MCP client" }) })) as { id: string };
      return `Recorded as #${r.id}. Anchor will follow up in Telegram at the deadline.`;
    }
    case "anchor_outcome":
      await api("/api/me/outcome", { method: "POST", body: JSON.stringify(args) });
      return "Outcome recorded. Anchor will use it next time.";
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg: { id?: number | string; method?: string; params?: Record<string, any> };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications (e.g. notifications/initialized)
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "anchor", version: "1.1.0" },
          instructions: "Anchor holds the user to their word. Recall their memory before planning; record promises they make; report outcomes.",
        },
      });
    } else if (method === "tools/list") send({ jsonrpc: "2.0", id, result: { tools } });
    else if (method === "tools/call") {
      try {
        const text = await call(params?.name, params?.arguments ?? {});
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      } catch (err) {
        send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true } });
      }
    } else if (method === "ping") send({ jsonrpc: "2.0", id, result: {} });
    else send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } });
  }
});

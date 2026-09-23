import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { evaluateForAccount } from "./service.mjs";
import { RULESET_VERSION, RULE_CATALOG } from "./rule-catalog.mjs";
import { listMemory, upsertMemory } from "./db.mjs";

function response(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload
  };
}

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
};

export function buildCognitiveBlockerMcpServer(context) {
  const accountId = context.accountId;
  const server = new McpServer(
    { name: "cognitive-blocker-plugin", version: "0.1.0" },
    {
      instructions:
        "This app is an account-scoped blocking layer. Before a material answer or action on a controlled path, call cognitive_blocker_check. " +
        "If the result is BLOCK, do not treat the proposed action or answer as valid. " +
        "Do not invent rules. Use only the canonical rule IDs returned by this server."
    }
  );

  server.registerTool(
    "cognitive_blocker_status",
    {
      title: "Cognitive blocker status",
      description: "Returns the fixed ruleset identity and enforcement boundary.",
      inputSchema: z.object({}),
      annotations: readOnly
    },
    async () => response({
      product: "Cognitive Blocker Plugin",
      rulesetVersion: RULESET_VERSION,
      canonicalRuleCount: RULE_CATALOG.length,
      accountScoped: true,
      enforcementBoundary: "MANDATORY_PATHS_ONLY"
    })
  );

  server.registerTool(
    "cognitive_blocker_check",
    {
      title: "Check proposed AI response or action",
      description: "Evaluates only the canonical blocking rules and returns ALLOW or BLOCK.",
      inputSchema: z.object({ payload: z.record(z.string(), z.unknown()) }),
      annotations: readOnly
    },
    async ({ payload }) => {
      return response(await evaluateForAccount(accountId, payload));
    }
  );

  server.registerTool(
    "cognitive_memory_put",
    {
      title: "Store account-scoped cognitive memory",
      description: "Stores a current memory item for this authenticated account only.",
      inputSchema: z.object({
        projectId: z.string().uuid().optional(),
        key: z.string().min(1).max(200),
        type: z.string().min(1).max(80),
        value: z.unknown(),
        claimState: z.enum(["EVIDENCE","INFERENCE","HYPOTHESIS","ESTIMATE","UNKNOWN","REFUTED"]),
        source: z.string().max(500).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
    },
    async (input) => response(await upsertMemory(accountId, input))
  );

  server.registerTool(
    "cognitive_memory_list",
    {
      title: "List relevant account memory",
      description: "Lists current memory for this authenticated account and optional project scope.",
      inputSchema: z.object({ projectId: z.string().uuid().optional() }),
      annotations: readOnly
    },
    async ({ projectId }) => response({ items: await listMemory(accountId, projectId || null) })
  );

  return server;
}

export function createCognitiveBlockerMcpNodeHandler(context) {
  const handler = createMcpHandler(() => buildCognitiveBlockerMcpServer(context), { legacy: "stateless" });
  return toNodeHandler(handler, {
    onerror: (error) => console.error(JSON.stringify({ event: "cognitive_mcp_error", message: error.message }))
  });
}

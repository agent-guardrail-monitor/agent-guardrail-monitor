import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { evaluateForAccount } from "./service.mjs";
import { RULESET_VERSION, RULE_CATALOG } from "./rule-catalog.mjs";
import {
  listErrors,
  listFeatureFlags,
  listMemory,
  recordError,
  setFeatureFlag,
  upsertMemory
} from "./db.mjs";
import { isFeatureEnabled, resolveFeatures } from "./feature-catalog.mjs";
import { buildInternalErrorReport } from "./internal-errors.mjs";
import { assertPermission, PERMISSIONS, permissionMatrix } from "./rbac.mjs";

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

const writeInternal = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
};

function authorize(role, permission) {
  assertPermission(role, permission);
}

export function buildCognitiveBlockerMcpServer(context) {
  const accountId = context.accountId;
  const role = context.role;
  const server = new McpServer(
    { name: "cognitive-blocker-plugin", version: "0.3.0" },
    {
      instructions:
        "This app is an account-scoped blocking layer with controlled recovery. Before a material answer or action on a controlled path, call cognitive_blocker_check. " +
        "If recovery.phase is CORRECT, preserve the validated parts, correct only the listed violations, then call cognitive_blocker_check again with the returned recoverySessionId. " +
        "If recovery.phase is ALLOW, the candidate may proceed on the controlled path. If recovery.phase is SAFE_STOP, stop automatic retries and do not claim completion. " +
        "Do not invent rules. Use only canonical rule IDs returned by this server. Tenant isolation, RBAC, recovery, feature flags, errors and audit state are internal to this plugin."
    }
  );

  server.registerTool(
    "cognitive_blocker_status",
    {
      title: "Cognitive blocker status",
      description: "Returns the fixed ruleset identity and internal control-plane status.",
      inputSchema: z.object({}),
      annotations: readOnly
    },
    async () => {
      authorize(role, PERMISSIONS.STATUS_READ);
      const overrides = await listFeatureFlags(accountId);
      return response({
        product: "Cognitive Blocker Plugin",
        version: "0.3.0",
        rulesetVersion: RULESET_VERSION,
        canonicalRuleCount: RULE_CATALOG.length,
        accountScoped: true,
        role,
        enforcementBoundary: "MANDATORY_PATHS_ONLY",
        features: resolveFeatures(overrides)
      });
    }
  );

  server.registerTool(
    "cognitive_blocker_check",
    {
      title: "Check proposed AI response or action",
      description: "Evaluates canonical blocking rules and drives the controlled CORRECT -> RECHECK -> ALLOW or SAFE_STOP recovery loop.",
      inputSchema: z.object({
        payload: z.record(z.string(), z.unknown()),
        recoverySessionId: z.string().uuid().optional()
      }),
      annotations: readOnly
    },
    async ({ payload, recoverySessionId }) => {
      authorize(role, PERMISSIONS.GUARD_CHECK);
      return response(await evaluateForAccount(accountId, {
        ...payload,
        recoverySessionId: recoverySessionId || payload.recoverySessionId || null
      }));
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
      annotations: writeInternal
    },
    async (input) => {
      authorize(role, PERMISSIONS.MEMORY_WRITE);
      return response(await upsertMemory(accountId, input));
    }
  );

  server.registerTool(
    "cognitive_memory_list",
    {
      title: "List relevant account memory",
      description: "Lists current memory for this authenticated account and optional project scope.",
      inputSchema: z.object({ projectId: z.string().uuid().optional() }),
      annotations: readOnly
    },
    async ({ projectId }) => {
      authorize(role, PERMISSIONS.MEMORY_READ);
      return response({ items: await listMemory(accountId, projectId || null) });
    }
  );

  server.registerTool(
    "cognitive_features_list",
    {
      title: "List internal plugin features",
      description: "Returns the internal feature catalog and this account's effective state.",
      inputSchema: z.object({}),
      annotations: readOnly
    },
    async () => {
      authorize(role, PERMISSIONS.FEATURES_READ);
      return response({ features: resolveFeatures(await listFeatureFlags(accountId)) });
    }
  );

  server.registerTool(
    "cognitive_feature_set",
    {
      title: "Set an internal optional feature",
      description: "Changes an internal feature flag. Required core controls cannot be disabled.",
      inputSchema: z.object({
        feature: z.string().min(1).max(120),
        enabled: z.boolean()
      }),
      annotations: writeInternal
    },
    async ({ feature, enabled }) => {
      authorize(role, PERMISSIONS.FEATURES_MANAGE);
      return response(await setFeatureFlag(accountId, role, feature, enabled));
    }
  );

  server.registerTool(
    "cognitive_report_error",
    {
      title: "Report an internal plugin error",
      description: "Captures a technical error report inside the plugin database. Secrets are redacted.",
      inputSchema: z.object({
        projectId: z.string().uuid().optional(),
        source: z.string().min(1).max(120).default("user_report"),
        errorCode: z.string().max(120).optional(),
        message: z.string().min(1).max(2000),
        context: z.record(z.string(), z.unknown()).optional(),
        requestFingerprint: z.string().max(256).optional()
      }),
      annotations: writeInternal
    },
    async (input) => {
      authorize(role, PERMISSIONS.ERRORS_REPORT);
      const overrides = await listFeatureFlags(accountId);
      if (!isFeatureEnabled("internal_error_reporting", overrides)) {
        return response({ stored: false, reason: "internal_error_reporting_disabled" });
      }
      const report = buildInternalErrorReport(input);
      return response(await recordError(accountId, report));
    }
  );

  server.registerTool(
    "cognitive_errors_list",
    {
      title: "List internal plugin errors",
      description: "Lists recent internal error reports for this account only.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      annotations: readOnly
    },
    async ({ limit }) => {
      authorize(role, PERMISSIONS.ERRORS_READ);
      return response({ items: await listErrors(accountId, limit) });
    }
  );

  server.registerTool(
    "cognitive_permission_matrix",
    {
      title: "Show internal permission matrix",
      description: "Returns the fixed internal RBAC permission matrix.",
      inputSchema: z.object({}),
      annotations: readOnly
    },
    async () => {
      authorize(role, PERMISSIONS.STATUS_READ);
      return response({ role, matrix: permissionMatrix() });
    }
  );

  return server;
}

export function createCognitiveBlockerMcpNodeHandler(context) {
  const handler = createMcpHandler(() => buildCognitiveBlockerMcpServer(context), { legacy: "stateless" });
  return toNodeHandler(handler, {
    onerror: (error) => console.error(JSON.stringify({
      event: "cognitive_mcp_error",
      message: error.message
    }))
  });
}

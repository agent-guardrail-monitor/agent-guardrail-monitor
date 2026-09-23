import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createAgmMcpNodeHandler } from "../server/chatgpt-mcp.mjs";

async function withMcpServer(run, context = {}) {
  const handler = createAgmMcpNodeHandler(context);
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(error.message);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/mcp`;
  try {
    return await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function parseSse(text) {
  const line = text.split(/\r?\n/).find((item) => item.startsWith("data: "));
  assert.ok(line, "expected MCP SSE data frame");
  return JSON.parse(line.slice(6));
}
async function mcpCall(url, id, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  assert.equal(response.status, 200);
  return parseSse(await response.text());
}

test("ChatGPT MCP lists AGM decision tools", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 1, "tools/list", {});
    const names = message.result.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      "agm_preflight",
      "agm_prepare_repair",
      "agm_prepare_repair_handoff",
      "agm_repair_preflight",
      "agm_status",
      "agm_validate_output",
      "agm_validate_repair",
      "guardiao_historico",
      "guardiao_pendencias",
      "guardiao_ultima_auditoria",
      "guardiao_verificar_agora"
    ]);
    for (const tool of message.result.tools) {
      assert.equal(tool.annotations.destructiveHint, false);
      if (tool.name === "guardiao_verificar_agora") {
        assert.equal(tool.annotations.readOnlyHint, false);
        assert.equal(tool.annotations.openWorldHint, true);
      } else {
        assert.equal(tool.annotations.readOnlyHint, true);
      }
    }
  });
});
test("ChatGPT MCP blocks a missing mandatory skill proof", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 2, "tools/call", {
      name: "agm_preflight",
      arguments: {
        objective: "Execute a task that requires the programming skill",
        actionKind: "respond",
        requiredSkills: ["programador"],
        skillExecution: []
      }
    });
    assert.equal(message.result.structuredContent.decision, "BLOCK");
    assert.equal(message.result.structuredContent.stage, "SKILL_RESOLUTION");
    assert.equal(message.result.structuredContent.code, "MANDATORY_SKILL_MISSING");
  });
});

test("ChatGPT MCP blocks destructive shell commands", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 3, "tools/call", {
      name: "agm_preflight",
      arguments: {
        objective: "Remove a directory tree",
        actionKind: "execute",
        tool: "shell",
        command: "rm -rf /tmp/agm-test"
      }
    });
    assert.equal(message.result.structuredContent.decision, "BLOCK");
    assert.equal(message.result.structuredContent.code, "RULE_BLOCK");
  });
});
test("ChatGPT MCP prepares an integrated AGM repair request", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 4, "tools/call", {
      name: "agm_prepare_repair",
      arguments: {
        regressions: [{
          runtime: "claude",
          code: "HOOK_EVENT_REMOVED",
          message: "PreToolUse disappeared from the approved configuration."
        }]
      }
    });
    const result = message.result.structuredContent;
    assert.equal(result.status, "REPAIR_REQUIRED");
    assert.equal(result.consumer.name, "Agent Guardrail Monitor Repair Engine");
    assert.equal(result.consumer.interface, "agm_repair_preflight");
    assert.equal(result.consumer.integrated, true);
    assert.equal(result.rootCauseState, "UNKNOWN");
    assert.match(result.repairRequest.failureEvidence[0], /HOOK_EVENT_REMOVED/);
  });
});


test("ChatGPT MCP repair preflight requires root cause before patching", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 5, "tools/call", {
      name: "agm_repair_preflight",
      arguments: {
        objective: "Repair a detected guardrail regression.",
        failureEvidence: ["[claude] HOOK_EVENT_REMOVED: PreToolUse disappeared."]
      }
    });
    const result = message.result.structuredContent;
    assert.equal(result.decision, "NEEDS_EVIDENCE");
    assert.equal(result.stage, "ROOT_CAUSE_REQUIRED");
    assert.deepEqual(result.missing, ["root_cause"]);
  });
});

test("ChatGPT MCP final gate rejects unknown factual claims", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 4, "tools/call", {
      name: "agm_validate_output",
      arguments: {
        preflightDecision: "ALLOW",
        claims: [{
          id: "claim-1",
          claim: "The task was completed.",
          verificationStatus: "UNKNOWN",
          presentedAsFact: true,
          material: true
        }]
      }
    });
    const result = message.result.structuredContent;
    assert.equal(result.release, false);
    assert.equal(result.decision, "BLOCK");
    assert.deepEqual(
      result.claims.violations.map((item) => item.code),
      ["UNKNOWN_PRESENTED_AS_FACT"]
    );
  });
});

test("O Guardião mostra auditorias dentro da IA conectada", async () => {
  const calls = [];
  const auditApi = {
    async pending(input) {
      calls.push(input);
      return {
        connected: true,
        mensagem: "Estas são as auditorias mais recentes do O Guardião.",
        audits: [{ repository: "acme/app", status: "APROVADO" }]
      };
    }
  };

  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 20, "tools/call", {
      name: "guardiao_pendencias",
      arguments: {}
    });
    assert.equal(message.result.structuredContent.connected, true);
    assert.equal(message.result.structuredContent.audits[0].status, "APROVADO");
    assert.equal(calls[0].installationId, 123);
    assert.equal(calls[0].platform, "chatgpt");
  }, {
    installationId: 123,
    platform: "chatgpt",
    auditApi
  });
});

test("O Guardião não expõe auditoria sem instalação conectada", async () => {
  await withMcpServer(async (url) => {
    const message = await mcpCall(url, 21, "tools/call", {
      name: "guardiao_ultima_auditoria",
      arguments: {}
    });
    assert.equal(message.result.structuredContent.connected, false);
  });
});
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");
const plugin = JSON.parse(read("plugin.json"));
const mcp = JSON.parse(read("mcp.json"));
const hooks = JSON.parse(read("hooks/hooks.json"));
const marketplace = JSON.parse(fs.readFileSync(new URL("../../../.agents/plugins/marketplace.json", import.meta.url), "utf8"));
const skill = read("skills/bloqueando-alucinacoes/SKILL.md");

test("portable plugin package has exact v0.5 identity and remote MCP", () => {
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "bloqueando-alucinacoes");
  assert.equal(plugin.version, "0.5.0");
  assert.equal(plugin.extensions["com.openai"].hooks, "./hooks/hooks.json");
  assert.equal(plugin.extensions["com.openai"].interface.displayName, "Bloqueando Alucinações");

  assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(mcp.mcpServers["cognitive-blocker"], {
    type: "streamable-http",
    url: "https://cognitive-blocker-plugin.onrender.com/mcp"
  });
});

test("marketplace points at the isolated cognitive-blocker package", () => {
  const entry = marketplace.plugins.find((item) => item.name === "bloqueando-alucinacoes");
  assert.ok(entry);
  assert.equal(entry.source.path, "./plugins/cognitive-blocker");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
});

test("Work/Codex hooks cover prompt, pre-tool and stop through the connected MCP", () => {
  for (const event of ["UserPromptSubmit", "PreToolUse", "Stop"]) {
    assert.ok(Array.isArray(hooks.hooks[event]) && hooks.hooks[event].length > 0);
    const handler = hooks.hooks[event][0].hooks[0];
    assert.equal(handler.type, "mcp_tool");
    assert.equal(handler.server, "cognitive-blocker");
  }
  assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].tool, "cognitive_hook_user_prompt");
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].tool, "cognitive_hook_pre_tool");
  assert.equal(hooks.hooks.Stop[0].hooks[0].tool, "cognitive_hook_stop");
});

test("skill requires controlled preflight and recheck without activation chatter", () => {
  assert.match(skill, /cognitive_turn_begin/);
  assert.match(skill, /cognitive_blocker_check/);
  assert.match(skill, /SAFE_STOP/);
  assert.match(skill, /Do not add activation chatter/);
});

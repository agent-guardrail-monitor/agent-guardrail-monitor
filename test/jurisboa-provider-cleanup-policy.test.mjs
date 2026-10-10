import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePolicy, validatePolicy } from "../src/enforcement/policy.mjs";

const policy = JSON.parse(readFileSync(new URL("../policy/chatgpt.default.json", import.meta.url), "utf8"));
const labels = ["jurisboa", "Anam-HeyGen-only", "verified", "user-approved", "20261010-cleanup"];
const tool = "mcp__Remote_Desktop_Commander__start_process";
const executionProof = "SRE preflight PROCEED after checking exact key, deployment and rollback";

const cases = [
  {
    objective: "Jurisboa: excluir somente anam.api_key na tabela lunna.secrets",
    kind: "delete_exact_neon_secret",
    command: "UIAutomate Neon SQL: DELETE FROM lunna.secrets WHERE name = 'anam.api_key' RETURNING name"
  },
  {
    objective: "Jurisboa: excluir somente LIVEAVATAR_API_KEY no serviço lunna",
    kind: "delete_exact_render_env",
    command: "$targetName = 'LIVEAVATAR_API_KEY'; UIAutomate Render variable exact match and delete"
  },
  {
    objective: "Jurisboa: excluir somente LUNNA_ANAM_AUDIT_ON_START no serviço lunna",
    kind: "delete_exact_render_env",
    command: "$targetName = 'LUNNA_ANAM_AUDIT_ON_START'; UIAutomate Render variable exact match and delete"
  }
];

function verdict(entry, extra = {}) {
  return evaluatePolicy(policy, {
    runtime: "chatgpt-mcp",
    phase: "PRE_ACTION",
    task: {
      originalObjective: extra.objective ?? entry.objective,
      labels: extra.labels ?? labels
    },
    action: {
      tool: extra.tool ?? tool,
      kind: extra.kind ?? entry.kind,
      args: { command: extra.command ?? entry.command },
      critical: true
    },
    skills: extra.skills ?? [{
      id: "software-repair",
      loaded: true,
      executed: true,
      executionProof
    }]
  });
}

test("policy is valid and still blocks unmatched critical actions", () => {
  assert.equal(validatePolicy(policy).valid, true);
  assert.equal(policy.strict, true);
  assert.equal(policy.defaults.criticalUnmatched, "BLOCK");
  assert.equal(verdict(cases[0], {
    objective: "Jurisboa: excluir todos os segredos na tabela lunna.secrets"
  }).decision, "BLOCK");
});

for (const entry of cases) {
  test("strictly permits approved exact cleanup: " + entry.objective, () => {
    const yes = verdict(entry);
    assert.equal(yes.decision, "ALLOW");
    assert.ok(yes.matchedRuleIds.some(id => id.includes("JURISBOA")));
  });
  test("rejects missing proof: " + entry.objective, () => {
    assert.equal(verdict(entry, {skills: []}).decision, "BLOCK");
  });
  test("rejects unapproved labels: " + entry.objective, () => {
    assert.equal(verdict(entry, {labels: ["jurisboa"]}).decision, "BLOCK");
  });
  test("rejects altered command: " + entry.objective, () => {
    assert.equal(verdict(entry, {command: "Remove-Item C:\\\\shared -Recurse"}).decision, "BLOCK");
  });
  test("rejects different tool: " + entry.objective, () => {
    assert.equal(verdict(entry, {tool: "mcp__GitHub__delete_file"}).decision, "BLOCK");
  });
}

test("never grants generic removal access", () => {
  assert.equal(verdict(cases[1], {
    objective: "Jurisboa: excluir somente LIVEAVATAR_API_KEY no serviço lunna",
    kind: "delete_exact_render_env",
    command: "$targetName = 'DATABASE_URL'; UIAutomate Render"
  }).decision, "BLOCK");
  assert.equal(verdict(cases[0], {
    command: "DELETE FROM lunna.secrets WHERE name = 'resend.api_key' RETURNING name"
  }).decision, "BLOCK");
});

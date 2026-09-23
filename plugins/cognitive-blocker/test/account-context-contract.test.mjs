import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL("../sql/004_account_wide_conversations.sql", import.meta.url),
  "utf8"
);
const context = fs.readFileSync(
  new URL("../src/context-rehydration.mjs", import.meta.url),
  "utf8"
);
const service = fs.readFileSync(
  new URL("../src/service.mjs", import.meta.url),
  "utf8"
);
const mcp = fs.readFileSync(
  new URL("../src/mcp.mjs", import.meta.url),
  "utf8"
);

test("installation contract is account-wide ALWAYS_ON", () => {
  assert.match(migration, /activation_mode text NOT NULL DEFAULT 'ALWAYS_ON'/);
  assert.match(migration, /auto_register_conversations boolean NOT NULL DEFAULT true/);
  assert.match(mcp, /This app is ALWAYS_ON for the installed account/);
  assert.match(mcp, /The user must not be asked to activate or invoke the plugin/);
});

test("raw chat history stays inside its own conversation", () => {
  assert.match(migration, /UNIQUE \(account_id, platform_conversation_ref\)/);
  assert.match(migration, /FOREIGN KEY \(conversation_id, account_id\)/);
  assert.match(context, /loadConversationContext\(\s*accountId,\s*conversation\.id/);
});

test("context priority keeps the current user message first", () => {
  const expected = [
    "current_user_message",
    "current_task",
    "conversation_context",
    "current_project_memory",
    "account_memory"
  ];
  for (const item of expected) assert.match(context, new RegExp(item));
  assert.ok(
    context.indexOf("current_user_message") < context.indexOf("account_memory"),
    "current user message must precede account memory"
  );
});

test("current user message is stored after previous history is rehydrated", () => {
  const history = context.indexOf("const history = await loadConversationContext");
  const append = context.indexOf('role: "user"', history);
  assert.ok(history >= 0 && append > history);
});

test("assistant candidates enter accepted history only after ALLOW", () => {
  assert.match(service, /if \(result\.decision === "ALLOW" && conversationContext\)/);
  assert.match(service, /acceptAssistantTurn/);
  assert.match(migration, /accepted_source IN \('USER_EXPLICIT','ALLOW'\)/);
  assert.doesNotMatch(migration, /accepted_source IN \([^)]*'BLOCK'/);
});

test("turn ordering is persisted rather than inferred from timestamps", () => {
  assert.match(migration, /position bigint GENERATED ALWAYS AS IDENTITY/);
  assert.match(context, /recentTurns/);
});

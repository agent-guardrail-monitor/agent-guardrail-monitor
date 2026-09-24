import test from "node:test";
import assert from "node:assert/strict";
import { applyMemoryContext } from "../src/service.mjs";

test("applies account and project memory automatically", () => {
  const payload = { task: {} };
  const memory = [
    {
      memory_key: "freeze-header",
      memory_type: "frozen_element",
      value: { resource: "header" }
    },
    {
      memory_key: "allow-auth",
      memory_type: "authorized_resource",
      value: { resource: "auth" }
    },
    {
      memory_key: "criterion-tests",
      memory_type: "success_criterion",
      value: { text: "tests pass", met: false }
    }
  ];

  const result = applyMemoryContext(payload, memory);
  assert.deepEqual(result.task.frozenElements, ["header"]);
  assert.deepEqual(result.task.authorizedResources, ["auth"]);
  assert.deepEqual(result.task.unmetSuccessCriteria, ["tests pass"]);
});

test("current explicit authorized scope overrides stored authorized resources", () => {
  const result = applyMemoryContext(
    { task: { authorizedResources: ["login"] } },
    [{
      memory_key: "old-auth",
      memory_type: "authorized_resource",
      value: { resource: "auth" }
    }]
  );
  assert.deepEqual(result.task.authorizedResources, ["login"]);
});

test("explicit unfreeze removes persisted frozen element", () => {
  const result = applyMemoryContext(
    { task: { unfrozenElements: ["header"] } },
    [{
      memory_key: "freeze-header",
      memory_type: "frozen_element",
      value: { resource: "header" }
    }]
  );
  assert.deepEqual(result.task.frozenElements, []);
});

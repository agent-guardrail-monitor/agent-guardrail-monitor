# ChatGPT MCP App — Agent Guardrail Monitor

This guide connects the Agent Guardrail Monitor (AGM) to ChatGPT as a custom remote MCP app.

## Production endpoint

```text
https://agent-guardrail-monitor.onrender.com/mcp
```

The endpoint uses MCP Streamable HTTP and supports the current stateless legacy compatibility path used by ChatGPT-compatible clients.

## Exposed tools

AGM exposes four read-only decision/integration tools:

- `agm_status`: returns policy identity, version, hash, and enforcement boundary.
- `agm_preflight`: evaluates the planned action before execution or response.
- `agm_prepare_repair_handoff`: converts AGM-observed regression evidence into a Software Repair Engineer preflight payload without patching anything.
- `agm_validate_output`: validates material claims and completion evidence before release.

All four tools declare `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false`.
## Connect in ChatGPT

Use ChatGPT on the web and enable Developer Mode for custom apps if your plan/workspace allows it.

1. Open **Settings → Apps → Advanced Settings** and enable **Developer mode**.
2. Open **Apps → Create**.
3. Set the app name to **Agent Guardrail Monitor**.
4. Set the MCP endpoint to:
   `https://agent-guardrail-monitor.onrender.com/mcp`
5. Choose **No authentication** for the current public read-only decision endpoint.
6. Run **Scan Tools**.
7. Confirm that the scan finds exactly:
   - `agm_status`
   - `agm_preflight`
   - `agm_prepare_repair_handoff`
   - `agm_validate_output`
8. Create the app and keep it enabled in **Settings → Apps → Enabled Apps**.

Current OpenAI guidance: Pro users can connect custom MCPs with read/fetch permissions in developer mode; full write/modify MCP support is available to Business and Enterprise/Edu workspaces.
## Expected behavior

When the app is invoked, its server instructions direct the host to:

1. call `agm_preflight` before a material action or answer;
2. stop when AGM returns `BLOCK`, `REQUIRE_REVIEW`, or `UNKNOWN`;
3. when verified AGM regression evidence requires repair, call `agm_prepare_repair_handoff` and pass its `repairRequest` to the separate Software Repair Engineer;
4. after repair, rerun AGM verification against the approved baseline;
5. call `agm_validate_output` before releasing a final answer with material factual or execution claims;
6. release only when the final gate returns `release=true`.

Example: if a task declares a mandatory skill and there is no `loaded + executed + executionProof` record for that skill, `agm_preflight` returns `BLOCK` with `MANDATORY_SKILL_MISSING`.

Example: if a completion claim has status `UNKNOWN` but is presented as fact, `agm_validate_output` returns `BLOCK` with `UNKNOWN_PRESENTED_AS_FACT`.
## Enforcement boundary

The ChatGPT custom-app integration reports `AVAILABLE_WHEN_INVOKED`.

That classification is deliberate. A custom MCP app can return deterministic decisions when ChatGPT calls it, but the app does not receive a universal interception point for every ordinary ChatGPT turn. Enabling the app keeps it available; it does not prove that the host will invoke it on every message.

For a hard gate that must run on every request and every response, place the model behind AGM in an application-owned API gateway:

```text
user → AGM preflight → model/tools → AGM output gate → user
```

That owned path can be classified as enforced only when the routing and canary evidence prove AGM is mandatory.

## Operational test

After connecting the app, ask ChatGPT to call `agm_status`. Confirm:

- `policyValid: true`
- `policyId: agm-chatgpt-default`
- `enforcementState: AVAILABLE_WHEN_INVOKED`

Then test a missing mandatory skill and an unknown factual claim. Both must return `BLOCK`.
## Data handling

The current MCP tools calculate policy decisions from the submitted objective, tool/skill metadata, and claim evidence. The application code does not persist those evaluation payloads. Hosting and network infrastructure may retain normal operational request metadata.

The existing GitHub App authentication and webhook secrets are separate from the public MCP decision endpoint. The MCP tools do not expose those secrets.

## Official references

- OpenAI Help: Developer mode and MCP apps in ChatGPT
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- OpenAI Developers: Build an MCP server for plugins
  https://developers.openai.com/plugins/build/mcp-server
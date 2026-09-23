# ChatGPT MCP App — Agent Guardrail Monitor

This guide connects Agent Guardrail Monitor (AGM) to ChatGPT as a custom remote MCP app.

## Production endpoint

```text
https://agent-guardrail-monitor.onrender.com/mcp
```

The endpoint uses MCP Streamable HTTP and supports the current stateless compatibility path used by ChatGPT-compatible clients.

## Exposed tools

AGM v0.3 exposes one unified monitoring, policy, repair-evidence, and validation surface:

- `agm_status`: returns policy identity, version, hash, capability, and enforcement boundary.
- `agm_preflight`: evaluates a planned action before execution or response.
- `agm_prepare_repair`: converts AGM-observed regression evidence into an internal integrated repair request.
- `agm_repair_preflight`: determines whether the repair has enough evidence to proceed to patching or final verification.
- `agm_validate_repair`: deterministic final gate for a `VERIFIED FIX` claim.
- `agm_validate_output`: validates material claims and completion evidence before release.
- `agm_prepare_repair_handoff`: deprecated compatibility alias for `agm_prepare_repair`; it no longer targets a separate repair product.

The MCP tools themselves are decision/evidence tools and declare read-only annotations. Repository mutation is performed by the GitHub App repair engine through approved GitHub App permissions.

## Connect in ChatGPT

Use ChatGPT on the web and enable Developer Mode for custom apps if your plan/workspace allows it.

1. Open **Settings → Apps → Advanced Settings** and enable **Developer mode**.
2. Open **Apps → Create**.
3. Set the app name to **Agent Guardrail Monitor**.
4. Set the MCP endpoint to:
   `https://agent-guardrail-monitor.onrender.com/mcp`
5. Choose **No authentication** for the current public MCP decision endpoint.
6. Run **Scan Tools**.
7. Confirm that the scan finds:
   - `agm_status`
   - `agm_preflight`
   - `agm_prepare_repair`
   - `agm_prepare_repair_handoff`
   - `agm_repair_preflight`
   - `agm_validate_repair`
   - `agm_validate_output`
8. Create the app and keep it enabled.

## Expected behavior

When the app is invoked, its server instructions direct the host to:

1. call `agm_preflight` before a material action or answer;
2. stop when AGM returns `BLOCK`, `REQUIRE_REVIEW`, or `UNKNOWN`;
3. when verified AGM regression evidence requires repair, call `agm_prepare_repair`;
4. keep diagnosis, patching, regression testing, and verification within the integrated AGM repair loop;
5. call `agm_repair_preflight` before a repair completion claim;
6. call `agm_validate_repair` immediately before claiming `VERIFIED FIX`;
7. rerun AGM verification against the original evidence after repair;
8. call `agm_validate_output` before releasing a final answer with material factual or execution claims.

The hosted GitHub App can independently run the same closed-loop repair workflow after a repairable default-branch regression. That operational path creates a repair branch and pull request and can optionally merge only when the repository explicitly selects `auto_merge`.

## Enforcement boundary

The ChatGPT custom-app integration reports `AVAILABLE_WHEN_INVOKED`.

That classification is deliberate. A custom MCP app can return deterministic decisions when ChatGPT calls it, but the app does not receive a universal interception point for every ordinary ChatGPT turn.

The GitHub App path is different: a subscribed GitHub push webhook reaches the hosted AGM service directly. Within that path, detection and configured repair execution are server-side product behavior subject to GitHub permissions, repository configuration, and the evidence gates.

## Operational test

After connecting the app, call `agm_status` and confirm:

- `policyValid: true`
- `policyId: agm-chatgpt-default`
- `enforcementState: AVAILABLE_WHEN_INVOKED`

Then test:

- a missing mandatory skill → AGM blocks;
- a regression repair request without a root cause → `agm_repair_preflight` requires more evidence;
- a `VERIFIED FIX` request without post-patch executable proof → `agm_validate_repair` blocks;
- an unknown factual claim presented as fact → `agm_validate_output` blocks.

## Data handling

The MCP tools calculate policy and repair-evidence decisions from submitted metadata and evidence. The application code does not persist those MCP evaluation payloads as customer records.

The integrated GitHub repair engine is covered by the project Privacy Policy. When repair is enabled, bounded relevant repository context may be processed by the configured repair model.

## Official references

- OpenAI Help: Developer mode and MCP apps in ChatGPT
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- OpenAI Developers: MCP server guidance
  https://developers.openai.com/plugins/build/mcp-server

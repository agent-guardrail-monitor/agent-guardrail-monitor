#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  console.error("Agent Guardrail Monitor fatal error:", error?.stack || error);
  process.exitCode = 2;
});
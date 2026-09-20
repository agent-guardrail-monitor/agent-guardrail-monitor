import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const APP_ID = String(process.env.GITHUB_APP_ID || "").trim();
const PRIVATE_KEY_B64 = String(process.env.GITHUB_PRIVATE_KEY_BASE64 || "").trim();
const WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || "");
const REPO_URL = "https://github.com/agent-guardrail-monitor/agent-guardrail-monitor";

function configured() {
  return Boolean(APP_ID && PRIVATE_KEY_B64 && WEBHOOK_SECRET);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function appJwt() {
  if (!APP_ID || !PRIVATE_KEY_B64) throw new Error("GitHub App credentials are not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID }));
  const unsigned = `${header}.${payload}`;
  const key = Buffer.from(PRIVATE_KEY_B64, "base64").toString("utf8");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function api(pathname, { token, method = "GET", body } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "agent-guardrail-monitor"
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 404) return null;
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 500)}`);
  }
  return data;
}

async function installationToken(installationId) {
  const data = await api(`/app/installations/${installationId}/access_tokens`, {
    token: appJwt(),
    method: "POST",
    body: {}
  });
  return data.token;
}

async function readContent(owner, repo, filePath, token) {
  const data = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    { token }
  );
  if (!data || Array.isArray(data) || data.type !== "file") return null;
  return Buffer.from(data.content || "", "base64").toString("utf8");
}

async function listDirectory(owner, repo, dirPath, token) {
  const data = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${dirPath.split("/").map(encodeURIComponent).join("/")}`,
    { token }
  );
  return Array.isArray(data) ? data : [];
}

function parseJsonConfig(runtime, filePath, text) {
  const result = { runtime, filePath, events: [], fails: [], unknowns: [] };
  try {
    const value = JSON.parse(text);
    const hooks = value && typeof value === "object" ? value.hooks : null;
    if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
      result.events = Object.keys(hooks).sort();
    }
    if (value?.disableAllHooks === true && result.events.length) {
      result.fails.push("Hooks are declared but disableAllHooks is true.");
    }
    if (runtime === "copilot" && value?.version !== 1) {
      result.fails.push("Copilot hook files require version: 1.");
    }
  } catch (error) {
    result.fails.push(`Invalid JSON: ${error.message}`);
  }
  return result;
}

function parseCodexToml(filePath, text) {
  const events = new Set();
  const regex = /\[\[\s*hooks\.([A-Za-z0-9_-]+)\s*\]\]/g;
  let match;
  while ((match = regex.exec(text))) events.add(match[1]);
  return {
    runtime: "codex",
    filePath,
    events: [...events].sort(),
    fails: [],
    unknowns: events.size ? ["Project hook trust and approval cannot be proven from repository files alone."] : []
  };
}

async function scanRepository(owner, repo, token) {
  const results = [];
  const fixed = [
    ["claude", ".claude/settings.json", "json"],
    ["codex", ".codex/hooks.json", "json"],
    ["codex", ".codex/config.toml", "toml"]
  ];

  for (const [runtime, filePath, format] of fixed) {
    const text = await readContent(owner, repo, filePath, token);
    if (text === null) continue;
    const item = format === "json"
      ? parseJsonConfig(runtime, filePath, text)
      : parseCodexToml(filePath, text);
    if (runtime === "codex" && item.events.length && format === "json") {
      item.unknowns.push("Project hook trust and approval cannot be proven from repository files alone.");
    }
    results.push(item);
  }

  const copilotFiles = await listDirectory(owner, repo, ".github/hooks", token);
  for (const entry of copilotFiles) {
    if (entry.type !== "file" || !entry.name.toLowerCase().endsWith(".json")) continue;
    const text = await readContent(owner, repo, entry.path, token);
    if (text !== null) results.push(parseJsonConfig("copilot", entry.path, text));
  }

  const fails = results.flatMap((x) => x.fails.map((message) => ({ ...x, message })));
  const unknowns = results.flatMap((x) => x.unknowns.map((message) => ({ ...x, message })));
  let state = "PASS";
  if (fails.length) state = "FAIL";
  else if (!results.length || unknowns.length) state = "UNKNOWN";

  return { state, results, fails, unknowns };
}

function markdown(scan) {
  const lines = [
    `**Guardrail status: ${scan.state}**`,
    "",
    "| Runtime | File | Hook events |",
    "| --- | --- | --- |"
  ];
  if (!scan.results.length) {
    lines.push("| — | — | No supported guardrail configuration found |");
  } else {
    for (const item of scan.results) {
      lines.push(`| ${item.runtime} | \`${item.filePath}\` | ${item.events.length ? item.events.join(", ") : "none detected"} |`);
    }
  }
  if (scan.fails.length) {
    lines.push("", "### Failures");
    for (const item of scan.fails) lines.push(`- **${item.runtime}** \`${item.filePath}\`: ${item.message}`);
  }
  if (scan.unknowns.length || !scan.results.length) {
    lines.push("", "### Unknown");
    if (!scan.results.length) lines.push("- No supported guardrail configuration was found in the repository.");
    for (const item of scan.unknowns) lines.push(`- **${item.runtime}** \`${item.filePath}\`: ${item.message}`);
  }
  lines.push("", "[Agent Guardrail Monitor repository](" + REPO_URL + ")");
  return lines.join("\n").slice(0, 65000);
}

async function publishCheck({ owner, repo, sha, installationId }) {
  const token = await installationToken(installationId);
  const scan = await scanRepository(owner, repo, token);
  const conclusion = scan.state === "FAIL" ? "failure" : scan.state === "PASS" ? "success" : "neutral";
  await api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`, {
    token,
    method: "POST",
    body: {
      name: "Agent Guardrail Monitor",
      head_sha: sha,
      status: "completed",
      conclusion,
      details_url: REPO_URL,
      output: {
        title: `Guardrail status: ${scan.state}`,
        summary: markdown(scan)
      }
    }
  });
  console.log(JSON.stringify({ event: "check_published", owner, repo, sha, state: scan.state }));
}

function verifySignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleWebhook(event, payload) {
  const installationId = payload.installation?.id;
  const repo = payload.repository;
  if (!installationId || !repo) return;

  if (event === "push" && payload.after && !/^0+$/.test(payload.after)) {
    await publishCheck({
      owner: repo.owner.login,
      repo: repo.name,
      sha: payload.after,
      installationId
    });
    return;
  }

  if (event === "check_suite" && ["requested", "rerequested"].includes(payload.action)) {
    const sha = payload.check_suite?.head_sha;
    if (sha) {
      await publishCheck({
        owner: repo.owner.login,
        repo: repo.name,
        sha,
        installationId
      });
    }
  }
}

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, JSON.stringify({ ok: true, configured: configured() }), "application/json");
  }

  if (req.method === "GET" && url.pathname === "/privacy") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Privacy - Agent Guardrail Monitor</title><h1>Privacy</h1><p>Agent Guardrail Monitor processes repository configuration required to evaluate coding-agent guardrails. The service does not sell user data. Repository source is not retained by the v0.1 service beyond transient processing required to generate checks.</p><p><a href="${REPO_URL}">Project repository</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/support") {
    return send(res, 302, "", "text/plain");
  }

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Agent Guardrail Monitor</title><h1>Agent Guardrail Monitor</h1><p>Detect when coding-agent updates break hooks and guardrails.</p><p><a href="${REPO_URL}">GitHub repository</a> · <a href="/privacy">Privacy</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method !== "POST" || url.pathname !== "/webhook") {
    return send(res, 404, "not found");
  }

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (!configured()) return send(res, 503, "not configured");
    if (!verifySignature(raw, req.headers["x-hub-signature-256"])) return send(res, 401, "invalid signature");

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(res, 400, "invalid json");
    }
    const event = String(req.headers["x-github-event"] || "");
    send(res, 202, "accepted");
    setImmediate(() => handleWebhook(event, payload).catch((error) => {
      console.error(JSON.stringify({ event: "webhook_error", type: event, message: error.message, stack: error.stack }));
    }));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port: PORT, configured: configured() }));
});
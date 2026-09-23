import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { createAgmMcpNodeHandler } from "./chatgpt-mcp.mjs";
import { PRODUCT_VERSION } from "../src/core.mjs";
import { summarizeMarketplacePurchase } from "../src/marketplace.mjs";
import { createOAuthTransaction, verifyOAuthTransaction } from "../src/github-oauth.mjs";
import { createOpenAIRepairModel } from "../src/repair/openai-model.mjs";
import { createIntegratedRepairModel } from "../src/repair/deterministic-model.mjs";
import { createGitHubRepairClient } from "../src/repair/github-client.mjs";
import { executeRepairCycle } from "../src/repair/executor.mjs";
import { parseRepairConfig } from "../src/repair/config.mjs";
import { compareRepositoryScans } from "../src/repair/regression.mjs";

const PORT = Number(process.env.PORT || 3000);
const APP_ID = String(process.env.GITHUB_APP_ID || "").trim();
const PRIVATE_KEY_B64 = String(process.env.GITHUB_PRIVATE_KEY_BASE64 || "").trim();
const PRIVATE_KEY_PATH = String(process.env.GITHUB_PRIVATE_KEY_PATH || "/etc/secrets/github-app.pem");
const WEBHOOK_SECRET_PATH = String(process.env.GITHUB_WEBHOOK_SECRET_PATH || "/etc/secrets/webhook-secret.txt");
const REPO_URL = "https://github.com/agent-guardrail-monitor/agent-guardrail-monitor";
const PUBLIC_NAME = "O Guardião - W";
const PUBLIC_BASE_URL = String(
  process.env.GUARDIAN_PUBLIC_URL || "https://agent-guardrail-monitor.onrender.com"
).replace(/\/$/, "");
const DAILY_RUN_KEY = String(process.env.GUARDIAN_DAILY_KEY || "").trim();
const AUDIT_CHECK_NAME = `${PUBLIC_NAME} · Auditoria`;
const DEPLOY_SHA = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim() || null;
const OAUTH_CLIENT_ID = String(process.env.GITHUB_CLIENT_ID || "Iv23lilPmMCpZGickCZN").trim();
const OAUTH_CLIENT_SECRET = String(process.env.GITHUB_CLIENT_SECRET || "").trim();
const OAUTH_CALLBACK_URL = String(
  process.env.GITHUB_OAUTH_CALLBACK_URL || "https://agent-guardrail-monitor.onrender.com/oauth/callback"
).trim();
const OAUTH_COOKIE_NAME = "agm_oauth";
const OPENAI_REPAIR_MODEL = createOpenAIRepairModel();
const REPAIR_MODEL = createIntegratedRepairModel({ fallback: OPENAI_REPAIR_MODEL });

function readSecretFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

const PRIVATE_KEY = readSecretFile(PRIVATE_KEY_PATH) ||
  (PRIVATE_KEY_B64 ? Buffer.from(PRIVATE_KEY_B64, "base64").toString("utf8").trim() : "");
const WEBHOOK_SECRET = String(process.env.GITHUB_WEBHOOK_SECRET || "").trim() ||
  readSecretFile(WEBHOOK_SECRET_PATH);
const OAUTH_STATE_SECRET = String(process.env.GITHUB_OAUTH_STATE_SECRET || "").trim() || WEBHOOK_SECRET;

function connectorSignature(installationId, platform) {
  const id = Number(installationId);
  const target = String(platform || "").trim().toLowerCase();
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("instalação inválida");
  if (!["chatgpt", "claude"].includes(target)) throw new Error("plataforma inválida");
  if (!WEBHOOK_SECRET) throw new Error("assinatura de conexão indisponível");
  return crypto.createHmac("sha256", WEBHOOK_SECRET)
    .update(`${id}:${target}`)
    .digest("base64url");
}

function connectorUrl(installationId, platform) {
  const url = new URL("/mcp", PUBLIC_BASE_URL);
  url.searchParams.set("installation_id", String(installationId));
  url.searchParams.set("platform", platform);
  url.searchParams.set("token", connectorSignature(installationId, platform));
  return url.toString();
}

function connectorContext(url) {
  const installationId = Number(url.searchParams.get("installation_id") || 0);
  const platform = String(url.searchParams.get("platform") || "").trim().toLowerCase();
  const supplied = String(url.searchParams.get("token") || "");
  if (!installationId && !platform && !supplied) return null;
  if (!installationId || !platform || !supplied) return false;

  let expected;
  try {
    expected = connectorSignature(installationId, platform);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return { installationId, platform };
}

function brazilDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}


function configured() {
  return Boolean(APP_ID && PRIVATE_KEY && WEBHOOK_SECRET);
}

function oauthConfigured() {
  return Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_CALLBACK_URL && OAUTH_STATE_SECRET);
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function appJwt() {
  if (!APP_ID || !PRIVATE_KEY) throw new Error("GitHub App credentials are not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: APP_ID }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), PRIVATE_KEY).toString("base64url");
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

function parseCookies(header) {
  const result = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    result[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function oauthCookie(value, maxAge = 600) {
  return `${OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/oauth/callback; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(res, location, cookie) {
  const headers = { location, "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(302, headers);
  res.end();
}

async function exchangeOAuthCode(code, verifier) {
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    code,
    redirect_uri: OAUTH_CALLBACK_URL,
    code_verifier: verifier
  });
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "agent-guardrail-monitor"
    },
    body
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(`GitHub OAuth exchange failed: ${data.error || response.status}`);
  }
  return data.access_token;
}

async function verifyUserInstallation(token, installationId) {
  const user = await api("/user", { token });
  const installation = await api(
    `/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=1`,
    { token }
  );
  if (!user?.id || !installation) throw new Error("Authorized user cannot verify this installation");
  return { userId: user.id };
}

async function beginInstallationSetup(res, url) {
  const installationId = Number(url.searchParams.get("installation_id") || 0);

  if (!installationId) {
    return send(
      res,
      200,
      `<!doctype html><meta charset="utf-8"><title>Conectar - ${PUBLIC_NAME}</title><h1>${PUBLIC_NAME}</h1><p>Conecte O Guardião ao seu GitHub para iniciar a primeira auditoria.</p><p><a href="https://github.com/apps/agent-guardrail-monitor">Conectar ao GitHub</a></p>`,
      "text/html; charset=utf-8"
    );
  }

  try {
    const reports = await runInstallationAudit({ installationId, kind: "initial" });
    console.log(JSON.stringify({
      event: "initial_audit_completed",
      installationId,
      repositories: reports.length
    }));
    return send(
      res,
      200,
      `<!doctype html><meta charset="utf-8"><title>Conectado - ${PUBLIC_NAME}</title><h1>${PUBLIC_NAME} está conectado</h1><p>A auditoria inicial foi executada. O resultado fica disponível para ser apresentado dentro do ChatGPT ou Claude.</p>`,
      "text/html; charset=utf-8"
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "initial_audit_error",
      installationId,
      message: error.message
    }));
    return send(res, 500, "A conexão foi feita, mas a auditoria inicial ainda não pôde ser concluída.");
  }
}

async function completeMarketplaceOAuth(req, res, url) {
  const error = url.searchParams.get("error");
  if (error) {
    res.setHeader("set-cookie", oauthCookie("", 0));
    return send(res, 400, "A conexão com o GitHub não foi concluída.");
  }

  const code = String(url.searchParams.get("code") || "");
  const state = String(url.searchParams.get("state") || "");
  const transaction = parseCookies(req.headers.cookie)[OAUTH_COOKIE_NAME];
  if (!code || !state || !transaction) throw new Error("OAuth callback is missing required state");

  const payload = verifyOAuthTransaction({
    transaction,
    state,
    secret: OAUTH_STATE_SECRET
  });
  const token = await exchangeOAuthCode(code, payload.verifier);
  const identity = await verifyUserInstallation(token, payload.installationId);

  console.log(JSON.stringify({
    event: "oauth_authorized",
    userId: identity.userId,
    installationId: Number(payload.installationId),
    marketplacePlanId: payload.marketplacePlanId == null ? null : Number(payload.marketplacePlanId)
  }));

  res.setHeader("set-cookie", oauthCookie("", 0));
  return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Conectado - ${PUBLIC_NAME}</title><h1>${PUBLIC_NAME} está conectado</h1><p>A conexão com o GitHub foi confirmada.</p><p><a href="${REPO_URL}">Ver projeto</a> &middot; <a href="/support">Ajuda</a></p>`, "text/html; charset=utf-8");
}

async function installationToken(installationId) {
  const data = await api(`/app/installations/${installationId}/access_tokens`, {
    token: appJwt(),
    method: "POST",
    body: {}
  });
  return data.token;
}

async function readContent(owner, repo, filePath, token, ref) {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}${suffix}`,
    { token }
  );
  if (!data || Array.isArray(data) || data.type !== "file") return null;
  return Buffer.from(data.content || "", "base64").toString("utf8");
}

async function listDirectory(owner, repo, dirPath, token, ref) {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${dirPath.split("/").map(encodeURIComponent).join("/")}${suffix}`,
    { token }
  );
  return Array.isArray(data) ? data : [];
}

async function readRepairConfig(owner, repo, token, ref) {
  const text = await readContent(owner, repo, ".agent-guardrail-monitor/config.json", token, ref);
  return parseRepairConfig(text);
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

async function scanRepository(owner, repo, token, ref) {
  const results = [];
  const fixed = [
    ["claude", ".claude/settings.json", "json"],
    ["codex", ".codex/hooks.json", "json"],
    ["codex", ".codex/config.toml", "toml"]
  ];

  for (const [runtime, filePath, format] of fixed) {
    const text = await readContent(owner, repo, filePath, token, ref);
    if (text === null) continue;
    const item = format === "json"
      ? parseJsonConfig(runtime, filePath, text)
      : parseCodexToml(filePath, text);
    if (runtime === "codex" && item.events.length && format === "json") {
      item.unknowns.push("Project hook trust and approval cannot be proven from repository files alone.");
    }
    results.push(item);
  }

  const copilotFiles = await listDirectory(owner, repo, ".github/hooks", token, ref);
  for (const entry of copilotFiles) {
    if (entry.type !== "file" || !entry.name.toLowerCase().endsWith(".json")) continue;
    const text = await readContent(owner, repo, entry.path, token, ref);
    if (text !== null) results.push(parseJsonConfig("copilot", entry.path, text));
  }

  const fails = results.flatMap((x) => x.fails.map((message) => ({ ...x, message })));
  const unknowns = results.flatMap((x) => x.unknowns.map((message) => ({ ...x, message })));
  let state = "PASS";
  if (fails.length) state = "FAIL";
  else if (!results.length || unknowns.length) state = "UNKNOWN";

  return { state, results, fails, unknowns };
}

async function verifyRepairCandidate({ owner, repo, token, baselineScan, ref }) {
  const candidate = await scanRepository(owner, repo, token, ref);
  const comparison = compareRepositoryScans(baselineScan, candidate);
  const pass = comparison.verdict === "PASS" && candidate.fails.length === 0;
  return {
    pass,
    summary: pass ? "Original guardrail regression no longer reproduces." : "Guardrail regression still reproduces.",
    evidence: JSON.stringify({
      state: candidate.state,
      remainingRegressions: comparison.regressions,
      failCount: candidate.fails.length
    })
  };
}

async function attemptAutomatedRepair({
  owner,
  repo,
  installationId,
  beforeSha,
  afterSha,
  defaultBranch,
  currentScan
}) {
  const token = await installationToken(installationId);
  const baselineScan = await scanRepository(owner, repo, token, beforeSha);
  const activeScan = currentScan || await scanRepository(owner, repo, token, afterSha);
  const regression = compareRepositoryScans(baselineScan, activeScan);
  if (regression.verdict !== "FAIL") return { status: "NO_REPAIR_REQUIRED" };

  const config = await readRepairConfig(owner, repo, token, afterSha);
  if (config.configError) {
    console.log(JSON.stringify({ event: "repair_config_invalid", owner, repo, sha: afterSha }));
    return { status: "REPAIR_CONFIG_INVALID" };
  }
  if (!config.enabled) return { status: "AUTO_REPAIR_DISABLED" };

  const repoClient = createGitHubRepairClient({ api, token, owner, repo });
  const result = await executeRepairCycle({
    owner,
    repo,
    defaultBranch,
    repairBaseSha: afterSha,
    baselineRef: beforeSha,
    objective: "Restore the guardrail controls that regressed on the default branch and verify the repair.",
    failureEvidence: regression.failureEvidence,
    repoClient,
    repairModel: REPAIR_MODEL,
    verify: ({ ref }) => verifyRepairCandidate({
      owner,
      repo,
      token,
      baselineScan,
      ref
    }),
    options: {
      autoMerge: config.autoMerge,
      waitForChecks: config.waitForChecks,
      checkTimeoutMs: config.checkTimeoutMs
    }
  });

  console.log(JSON.stringify({
    event: "repair_cycle_completed",
    owner,
    repo,
    detectedAt: afterSha,
    repairStatus: result.status,
    finalState: result.finalState,
    pullRequest: result.pullRequest || null
  }));
  return result;
}

function auditKindLabel(kind) {
  if (kind === "initial") return "inicial";
  if (kind === "manual") return "agora";
  return "diária";
}

function encodeAuditMeta(meta) {
  return "guardiao:" + Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
}

function decodeAuditMeta(value) {
  const text = String(value || "");
  if (!text.startsWith("guardiao:")) return null;
  try {
    return JSON.parse(Buffer.from(text.slice(9), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function repairPublicStatus(result) {
  const status = String(result?.status || "");
  if (!result || status === "NO_REPAIR_REQUIRED") {
    return "Nenhum conserto foi necessário.";
  }
  if (status === "AUTO_REPAIR_VERIFIED") {
    return "O conserto foi aplicado e testado.";
  }
  if (status === "VERIFIED_REPAIR_PR_OPENED") {
    return "O conserto foi preparado e testado. Está separado para revisão.";
  }
  if (status === "REPAIR_PR_OPENED_NEEDS_REVIEW") {
    return "O conserto foi preparado, mas ainda precisa de revisão.";
  }
  if (status === "AUTO_REPAIR_DISABLED") {
    return "O conserto automático está desligado para este repositório.";
  }
  return "A falha foi registrada e o conserto precisa de revisão.";
}

async function listAppInstallations() {
  const installations = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await api(`/app/installations?per_page=100&page=${page}`, {
      token: appJwt()
    });
    if (!Array.isArray(batch) || !batch.length) break;
    installations.push(...batch);
    if (batch.length < 100) break;
  }
  return installations;
}

async function listInstallationRepositories(installationId, token = null) {
  const installationTokenValue = token || await installationToken(installationId);
  const repositories = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = await api(`/installation/repositories?per_page=100&page=${page}`, {
      token: installationTokenValue
    });
    const batch = Array.isArray(data?.repositories) ? data.repositories : [];
    repositories.push(...batch);
    if (batch.length < 100) break;
  }
  return { token: installationTokenValue, repositories };
}

async function repositoryHead(owner, repo, token, defaultBranch) {
  const branch = String(defaultBranch || "main");
  const ref = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
    { token }
  );
  return ref?.object?.sha || null;
}

async function commitParent(owner, repo, token, sha) {
  const commit = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
    { token }
  );
  return commit?.parents?.[0]?.sha || null;
}

async function publishAuditRecord({
  token,
  owner,
  repo,
  sha,
  kind,
  scan,
  repairResult
}) {
  const createdAt = new Date().toISOString();
  const meta = {
    v: 1,
    k: kind,
    d: brazilDate(new Date(createdAt)),
    t: createdAt,
    s: scan.state,
    f: scan.fails.length,
    u: scan.unknowns.length,
    r: repairResult?.status || null,
    p: repairResult?.pullRequest?.number || null
  };
  const conclusion = scan.state === "FAIL"
    ? "failure"
    : scan.state === "PASS"
      ? "success"
      : "neutral";
  const summary = [
    markdown(scan),
    "",
    "### Conserto",
    repairPublicStatus(repairResult),
    "",
    `Auditoria ${auditKindLabel(kind)} concluída em ${meta.d}.`
  ].join("\n").slice(0, 65000);

  const run = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`,
    {
      token,
      method: "POST",
      body: {
        name: AUDIT_CHECK_NAME,
        head_sha: sha,
        status: "completed",
        conclusion,
        external_id: encodeAuditMeta(meta),
        details_url: REPO_URL,
        output: {
          title: `Auditoria ${auditKindLabel(kind)}: ${publicState(scan.state)}`,
          summary
        }
      }
    }
  );

  return {
    id: run?.id || null,
    repository: `${owner}/${repo}`,
    kind,
    date: meta.d,
    createdAt,
    status: publicState(scan.state),
    fails: meta.f,
    unknowns: meta.u,
    repair: repairPublicStatus(repairResult),
    repairStatus: meta.r,
    pullRequest: meta.p
  };
}

async function runRepositoryAudit({
  installationId,
  repository,
  token,
  kind = "daily"
}) {
  const owner = repository.owner?.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch || "main";
  if (!owner || !repo) throw new Error("repositório inválido");

  const sha = await repositoryHead(owner, repo, token, defaultBranch);
  if (!sha) throw new Error("não foi possível localizar a versão atual do repositório");

  const scan = await scanRepository(owner, repo, token, sha);
  let repairResult = null;

  if (scan.state === "FAIL") {
    const beforeSha = await commitParent(owner, repo, token, sha);
    if (beforeSha) {
      try {
        repairResult = await attemptAutomatedRepair({
          owner,
          repo,
          installationId,
          beforeSha,
          afterSha: sha,
          defaultBranch,
          currentScan: scan
        });
      } catch (error) {
        repairResult = {
          status: "REPAIR_BLOCKED",
          reason: String(error.message || error)
        };
      }
    }
  }

  return publishAuditRecord({
    token,
    owner,
    repo,
    sha,
    kind,
    scan,
    repairResult
  });
}

async function runInstallationAudit({
  installationId,
  kind = "daily",
  repository = null
}) {
  const listed = await listInstallationRepositories(installationId);
  let repositories = listed.repositories;
  const requested = String(repository || "").trim();
  if (requested) {
    repositories = repositories.filter((item) =>
      item.full_name === requested || item.name === requested
    );
  }

  const reports = [];
  for (const item of repositories) {
    try {
      reports.push(await runRepositoryAudit({
        installationId,
        repository: item,
        token: listed.token,
        kind
      }));
    } catch (error) {
      reports.push({
        repository: item.full_name || item.name,
        kind,
        status: "DESCONHECIDO",
        error: String(error.message || error)
      });
    }
  }
  return reports;
}

async function recentCommitShas(owner, repo, token, defaultBranch) {
  const shas = new Set();
  const head = await repositoryHead(owner, repo, token, defaultBranch);
  if (head) shas.add(head);

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const commits = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${encodeURIComponent(since)}&per_page=50`,
    { token }
  );
  for (const commit of Array.isArray(commits) ? commits : []) {
    if (commit?.sha) shas.add(commit.sha);
  }
  return [...shas];
}

function auditRecordFromCheck(repository, run) {
  const meta = decodeAuditMeta(run?.external_id);
  if (!meta) return null;
  return {
    repository,
    kind: meta.k,
    date: meta.d,
    createdAt: meta.t || run?.completed_at || run?.started_at || null,
    status: publicState(meta.s),
    fails: Number(meta.f || 0),
    unknowns: Number(meta.u || 0),
    repairStatus: meta.r || null,
    pullRequest: meta.p || null,
    summary: run?.output?.summary || null
  };
}

async function listAuditsForRepository({
  token,
  repository,
  limit = 20
}) {
  const owner = repository.owner?.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch || "main";
  const records = [];
  const shas = await recentCommitShas(owner, repo, token, defaultBranch);

  for (const sha of shas) {
    const data = await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/check-runs?filter=all&per_page=100`,
      { token }
    );
    for (const run of data?.check_runs || []) {
      if (run?.name !== AUDIT_CHECK_NAME) continue;
      const record = auditRecordFromCheck(repository.full_name, run);
      if (record) records.push(record);
    }
  }

  records.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return records.slice(0, limit);
}

async function selectedRepositories(installationId, repository = null) {
  const listed = await listInstallationRepositories(installationId);
  const requested = String(repository || "").trim();
  const repositories = requested
    ? listed.repositories.filter((item) =>
        item.full_name === requested || item.name === requested
      )
    : listed.repositories;
  return { token: listed.token, repositories };
}

async function ensureDailyAudit(installationId, repository = null) {
  const selected = await selectedRepositories(installationId, repository);
  const today = brazilDate();
  const executed = [];

  for (const item of selected.repositories) {
    const recent = await listAuditsForRepository({
      token: selected.token,
      repository: item,
      limit: 20
    });
    const exists = recent.some((record) =>
      record.kind === "daily" && record.date === today
    );
    if (!exists) {
      executed.push(await runRepositoryAudit({
        installationId,
        repository: item,
        token: selected.token,
        kind: "daily"
      }));
    }
  }
  return { selected, executed };
}

async function auditHistory({
  installationId,
  repository = null,
  limit = 7,
  ensureToday = false
}) {
  if (ensureToday) await ensureDailyAudit(installationId, repository);
  const selected = await selectedRepositories(installationId, repository);
  const records = [];
  for (const item of selected.repositories) {
    records.push(...await listAuditsForRepository({
      token: selected.token,
      repository: item,
      limit
    }));
  }
  records.sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return {
    connected: true,
    repositories: selected.repositories.map((item) => item.full_name),
    audits: records.slice(0, limit)
  };
}

const auditApi = {
  async pending({ installationId, platform, repository }) {
    const history = await auditHistory({
      installationId,
      repository,
      limit: 5,
      ensureToday: true
    });
    return {
      ...history,
      platform,
      mensagem: history.audits.length
        ? "Estas são as auditorias mais recentes do O Guardião."
        : "Ainda não há auditorias registradas."
    };
  },

  async latest({ installationId, repository }) {
    const history = await auditHistory({
      installationId,
      repository,
      limit: 1,
      ensureToday: true
    });
    return {
      connected: true,
      repositories: history.repositories,
      audit: history.audits[0] || null
    };
  },

  async history({ installationId, repository, limit }) {
    return auditHistory({
      installationId,
      repository,
      limit,
      ensureToday: false
    });
  },

  async runNow({ installationId, repository }) {
    const reports = await runInstallationAudit({
      installationId,
      repository,
      kind: "manual"
    });
    return {
      connected: true,
      mensagem: "Verificação concluída.",
      audits: reports
    };
  }
};

async function runAllDailyAudits() {
  const installations = await listAppInstallations();
  const results = [];
  for (const installation of installations) {
    try {
      const before = await ensureDailyAudit(installation.id);
      results.push({
        installationId: installation.id,
        repositories: before.selected.repositories.length,
        executed: before.executed.length
      });
    } catch (error) {
      results.push({
        installationId: installation.id,
        error: String(error.message || error)
      });
    }
  }
  return results;
}

function publicState(state) {
  if (state === "PASS") return "APROVADO";
  if (state === "FAIL") return "FALHA";
  return "DESCONHECIDO";
}

function publicMessage(message) {
  const value = String(message || "");
  if (value === "Hooks are declared but disableAllHooks is true.") {
    return "A trava de segurança existe, mas está desligada.";
  }
  if (value === "Copilot hook files require version: 1.") {
    return "A configuração do Copilot está fora do padrão esperado.";
  }
  if (/^Invalid JSON:/i.test(value)) {
    return "A configuração está inválida.";
  }
  if (/trust and approval cannot be proven/i.test(value)) {
    return "Não foi possível confirmar se esse gatilho automático está ativo.";
  }
  return value
    .replaceAll("Hooks", "Travas de segurança")
    .replaceAll("hooks", "travas de segurança");
}

function markdown(scan) {
  const state = publicState(scan.state);
  const lines = [
    `**Travas de segurança: ${state}**`,
    "",
    "| IA | Onde está a trava | Gatilhos automáticos |",
    "| --- | --- | --- |"
  ];

  if (!scan.results.length) {
    lines.push("| — | — | Nenhuma trava de segurança compatível foi encontrada |");
  } else {
    for (const item of scan.results) {
      lines.push(
        `| ${item.runtime} | \`${item.filePath}\` | ${item.events.length ? item.events.join(", ") : "nenhum identificado"} |`
      );
    }
  }

  if (scan.fails.length) {
    lines.push("", "### FALHA");
    for (const item of scan.fails) {
      lines.push(`- **${item.runtime}**: ${publicMessage(item.message)}`);
    }
  }

  if (scan.unknowns.length || !scan.results.length) {
    lines.push("", "### DESCONHECIDO");
    if (!scan.results.length) {
      lines.push("- Não foi possível encontrar uma trava de segurança compatível para confirmar.");
    }
    for (const item of scan.unknowns) {
      lines.push(`- **${item.runtime}**: ${publicMessage(item.message)}`);
    }
  }

  lines.push("", `[${PUBLIC_NAME}](${REPO_URL})`);
  return lines.join("\n").slice(0, 65000);
}

async function publishCheck({ owner, repo, sha, installationId }) {
  const token = await installationToken(installationId);
  const scan = await scanRepository(owner, repo, token, sha);
  const conclusion = scan.state === "FAIL" ? "failure" : scan.state === "PASS" ? "success" : "neutral";
  await api(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`, {
    token,
    method: "POST",
    body: {
      name: PUBLIC_NAME,
      head_sha: sha,
      status: "completed",
      conclusion,
      details_url: REPO_URL,
      output: {
        title: `Travas de segurança: ${publicState(scan.state)}`,
        summary: markdown(scan)
      }
    }
  });
  console.log(JSON.stringify({ event: "check_published", owner, repo, sha, state: scan.state }));
  return { scan, token };
}

function verifySignature(rawBody, signature) {
  if (!WEBHOOK_SECRET) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleWebhook(event, payload) {
  if (event === "marketplace_purchase") {
    console.log(JSON.stringify(summarizeMarketplacePurchase(payload)));
    return;
  }

  const installationId = payload.installation?.id;
  const repo = payload.repository;
  if (!installationId || !repo) return;

  if (event === "push" && payload.after && !/^0+$/.test(payload.after)) {
    const published = await publishCheck({
      owner: repo.owner.login,
      repo: repo.name,
      sha: payload.after,
      installationId
    });

    const defaultBranch = repo.default_branch || "main";
    const defaultRef = `refs/heads/${defaultBranch}`;
    const beforeSha = String(payload.before || "");
    if (payload.ref === defaultRef && beforeSha && !/^0+$/.test(beforeSha)) {
      try {
        await attemptAutomatedRepair({
          owner: repo.owner.login,
          repo: repo.name,
          installationId,
          beforeSha,
          afterSha: payload.after,
          defaultBranch,
          currentScan: published.scan
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: "auto_repair_error",
          owner: repo.owner.login,
          repo: repo.name,
          sha: payload.after,
          message: error.message
        }));
      }
    }
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

  if (url.pathname === "/mcp") {
    agmMcpNodeHandler(req, res).catch((error) => {
      console.error(JSON.stringify({ event: "mcp_error", message: error.message }));
      if (!res.headersSent) send(res, 500, "mcp error");
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, JSON.stringify({ ok: true, configured: configured(), version: PRODUCT_VERSION, mcp: true, commit: DEPLOY_SHA, repair: { configured: true, strategy: "deterministic-first", model: REPAIR_MODEL.model, deterministic: true, aiFallbackConfigured: REPAIR_MODEL.fallbackConfigured, aiFallbackModel: REPAIR_MODEL.fallbackModel } }), "application/json");
  }

  if (req.method === "GET" && url.pathname === "/setup") {
    beginInstallationSetup(res, url).catch((error) => {
      console.error(JSON.stringify({ event: "setup_error", message: error.message }));
      if (!res.writableEnded) send(res, 500, "Não foi possível concluir a instalação.");
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth/callback") {
    completeMarketplaceOAuth(req, res, url).catch((error) => {
      console.error(JSON.stringify({ event: "oauth_error", message: error.message }));
      if (!res.headersSent) res.setHeader("set-cookie", oauthCookie("", 0));
      if (!res.writableEnded) send(res, 400, "Não foi possível confirmar a conexão com o GitHub.");
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/privacy") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Privacidade - ${PUBLIC_NAME}</title><h1>Privacidade</h1><p>O Guardião lê apenas o que precisa para verificar as travas de segurança e fazer um conserto quando você habilita essa função.</p><p>O conserto usa primeiro o último estado aprovado. Um serviço externo de IA só entra como apoio opcional quando esse caminho não é suficiente.</p><p>Seus dados não são vendidos.</p><p><a href="${REPO_URL}/blob/main/docs/PRIVACY.md">Política completa</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/support") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Ajuda - ${PUBLIC_NAME}</title><h1>Ajuda</h1><p>Encontrou um problema ou precisa de ajuda? Fale com a gente pelo GitHub.</p><p><a href="${REPO_URL}/issues">Abrir atendimento</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/eula") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Contrato - ${PUBLIC_NAME}</title><h1>Contrato de uso</h1><p>O Guardião acompanha e, quando autorizado, conserta travas de segurança dentro do alcance descrito para esta versão.</p><p><a href="${REPO_URL}/blob/main/docs/EULA.md">Ler contrato completo</a> &middot; <a href="/support">Ajuda</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/terms") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Termos - ${PUBLIC_NAME}</title><h1>Termos</h1><p>O Guardião acompanha as travas de segurança dos robôs de IA. Por padrão, todo conserto fica separado para revisão. O modo totalmente automático só funciona quando você escolhe essa opção.</p><p><a href="${REPO_URL}/blob/main/docs/EULA.md">Contrato de uso</a> &middot; <a href="/support">Ajuda</a></p>`, "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, `<!doctype html><meta charset="utf-8"><title>${PUBLIC_NAME}</title><h1>${PUBLIC_NAME}</h1><h2>Sua IA trabalha. O Guardião confere se ela continua respeitando as regras.</h2><p>Feito para empresas que usam Claude Code, OpenAI Codex ou GitHub Copilot.</p><p>Quando um robô faz o que não podia, o Guardião identifica a falha, guarda a prova e prepara o conserto.</p><p><strong>acha → prova → conserta → testa → fecha</strong></p><p><strong>APROVADO</strong>: a trava de segurança está funcionando.<br><strong>FALHA</strong>: o robô fez o que não podia ou uma trava deixou de funcionar.<br><strong>DESCONHECIDO</strong>: ainda falta prova para confirmar.</p><p>Por padrão, todo conserto fica separado para sua equipe revisar. O modo totalmente automático só é ativado quando você escolher.</p><p><a href="https://github.com/apps/agent-guardrail-monitor">Conectar ao GitHub</a> &middot; <a href="/privacy">Privacidade</a> &middot; <a href="/terms">Termos</a> &middot; <a href="/support">Ajuda</a></p>`, "text/html; charset=utf-8");
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
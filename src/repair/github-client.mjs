function enc(value) {
  return encodeURIComponent(String(value));
}

function pathUrl(path) {
  return String(path).split("/").map(enc).join("/");
}

function branchUrl(branch) {
  return String(branch).split("/").map(enc).join("/");
}

function decodeContent(data) {
  if (!data || Array.isArray(data) || data.type !== "file") return null;
  return {
    path: data.path,
    sha: data.sha,
    content: Buffer.from(data.content || "", "base64").toString("utf8")
  };
}

function contextCandidatePaths(failureEvidence = []) {
  const paths = new Set([
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".codex/hooks.json",
    ".codex/config.toml",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "README.md"
  ]);
  const pattern = /(?:^|[\s`'"])(\.(?:claude|codex|github)\/[A-Za-z0-9._\/-]+)/g;
  for (const evidence of failureEvidence) {
    let match;
    while ((match = pattern.exec(String(evidence)))) paths.add(match[1]);
  }
  return [...paths];
}

export function createGitHubRepairClient({ api, token, owner, repo }) {
  if (typeof api !== "function") throw new TypeError("api function is required");
  if (!token || !owner || !repo) throw new Error("GitHub repair client requires token, owner, and repo");

  const repoPath = `/repos/${enc(owner)}/${enc(repo)}`;

  async function getFile(path, ref) {
    const suffix = ref ? `?ref=${enc(ref)}` : "";
    const data = await api(`${repoPath}/contents/${pathUrl(path)}${suffix}`, { token });
    return decodeContent(data);
  }

  return {
    async getRepository() {
      return api(repoPath, { token });
    },

    async getHead(ref) {
      const data = await api(`${repoPath}/git/ref/heads/${branchUrl(ref)}`, { token });
      return data?.object?.sha || null;
    },

    getFile,

    async readRepairContext({ ref, failureEvidence = [] } = {}) {
      const result = [];
      const seen = new Set();
      const candidates = contextCandidatePaths(failureEvidence);

      const hooks = await api(`${repoPath}/contents/.github/hooks${ref ? `?ref=${enc(ref)}` : ""}`, { token });
      if (Array.isArray(hooks)) {
        for (const item of hooks) {
          if (item?.type === "file" && String(item.name).toLowerCase().endsWith(".json")) {
            candidates.push(item.path);
          }
        }
      }

      let total = 0;
      for (const path of candidates) {
        if (seen.has(path)) continue;
        seen.add(path);
        const file = await getFile(path, ref);
        if (!file) continue;
        const content = file.content.slice(0, 60_000);
        if (total + content.length > 220_000) break;
        total += content.length;
        result.push({ path: file.path, sha: file.sha, content });
      }
      return result;
    },

    async createBranch(branch, baseSha) {
      return api(`${repoPath}/git/refs`, {
        token,
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: baseSha }
      });
    },

    async upsertFile({ path, content, branch, message }) {
      const current = await getFile(path, branch);
      const body = {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch
      };
      if (current?.sha) body.sha = current.sha;
      return api(`${repoPath}/contents/${pathUrl(path)}`, {
        token,
        method: "PUT",
        body
      });
    },

    async createPullRequest({ title, body, head, base }) {
      return api(`${repoPath}/pulls`, {
        token,
        method: "POST",
        body: { title, body, head, base, draft: false }
      });
    },

    async getCheckRuns(ref) {
      const data = await api(`${repoPath}/commits/${enc(ref)}/check-runs`, { token });
      return Array.isArray(data?.check_runs) ? data.check_runs : [];
    },

    async waitForChecks(ref, { timeoutMs = 180_000, pollMs = 5_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const runs = await this.getCheckRuns(ref);
        const relevant = runs.filter((run) => run?.name !== "Agent Guardrail Monitor");
        const pending = relevant.filter((run) => run.status !== "completed");
        const failed = relevant.filter((run) =>
          run.status === "completed" && !["success", "neutral", "skipped"].includes(run.conclusion)
        );
        if (failed.length) return { status: "failed", runs: relevant, failed };
        if (relevant.length && pending.length === 0) return { status: "passed", runs: relevant, failed: [] };
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      return { status: "timeout", runs: await this.getCheckRuns(ref), failed: [] };
    },

    async mergePullRequest({ number, sha, method = "squash" }) {
      return api(`${repoPath}/pulls/${Number(number)}/merge`, {
        token,
        method: "PUT",
        body: {
          sha,
          merge_method: method,
          commit_title: `Agent Guardrail Monitor automated repair (#${number})`
        }
      });
    }
  };
}

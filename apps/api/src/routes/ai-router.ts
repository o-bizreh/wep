import { Router, type Request, type Response } from 'express';
import { Octokit } from '@octokit/rest';
import { problemDetails } from '@wep/domain-types';
import { BedrockRuntimeClient, InvokeModelCommand, credentialStore, regionStore } from '@wep/aws-clients';

function getOctokit(): Octokit {
  return new Octokit({ auth: process.env['GITHUB_TOKEN'] });
}

interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

async function fetchPrFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<PrFile[]> {
  const files: PrFile[] = [];
  for await (const response of octokit.paginate.iterator(
    octokit.pulls.listFiles,
    { owner, repo, pull_number: prNumber, per_page: 100 },
  )) {
    for (const f of response.data) {
      files.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch?.slice(0, 500),
      });
    }
  }
  return files;
}

const MODEL_ID = process.env['BEDROCK_MODEL_ID'] ?? 'eu.amazon.nova-micro-v1:0';

const bedrockClient = new BedrockRuntimeClient({
  region: regionStore.getProvider(),
  credentials: credentialStore.getProvider(),
});

async function invoke(prompt: string, maxTokens = 1200, systemPrompt?: string): Promise<string> {
  const body = JSON.stringify({
    ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens, temperature: 0.3 },
  });
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });
  const res = await bedrockClient.send(cmd);
  const decoded = new TextDecoder().decode(res.body);
  const parsed = JSON.parse(decoded) as { output?: { message?: { content?: Array<{ text?: string }> } } };
  return parsed.output?.message?.content?.[0]?.text ?? '';
}

const SCENARIO_FOOTER = `
Structure your response as:
## Summary
2–3 sentence overview of the situation and key finding.

---

## Scenario 1 — [descriptive title]
[analysis]

## Scenario 2 — [descriptive title]
[analysis]

## Scenario 3 — [descriptive title]
[analysis]

---

## General Recommendation
Clear, actionable overall recommendation based on all scenarios.`;

function err(res: Response, msg: string) {
  res.status(500).json(problemDetails(500, 'AI error', msg));
}

export function createAiRouter(): Router {
  const router = Router();

  // POST /ai/runbook
  router.post('/runbook', async (req: Request, res: Response) => {
    const { problem } = req.body as { problem?: string };
    if (!problem) { res.status(400).json(problemDetails(400, 'Bad request', 'problem is required')); return; }
    try {
      const text = await invoke(
        `You are a senior SRE. Analyze this incident/problem and produce a runbook.

Problem: ${problem.slice(0, 1000)}

${SCENARIO_FOOTER.replace('Scenario 1', 'Scenario 1 — Most likely cause').replace('Scenario 2', 'Scenario 2 — Alternative cause').replace('Scenario 3', 'Scenario 3 — Worst case')}

For each scenario include: Likely Cause, Investigation Steps (numbered), Remediation Steps (numbered), Escalation trigger.
Use markdown.`
      );
      res.json({ runbook: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/digest
  router.post('/digest', async (req: Request, res: Response) => {
    const { serviceName, deployments } = req.body as { serviceName?: string; deployments?: unknown[] };
    if (!serviceName || !deployments) { res.status(400).json(problemDetails(400, 'Bad request', 'serviceName and deployments required')); return; }
    try {
      const data = JSON.stringify(deployments.slice(0, 20));
      const text = await invoke(
        `You are a DevOps analyst. Analyze the deployment history for ${serviceName}.

Deployments (JSON): ${data}

${SCENARIO_FOOTER.replace('Scenario 1', 'Scenario 1 — Deployment health assessment').replace('Scenario 2', 'Scenario 2 — Risk areas identified').replace('Scenario 3', 'Scenario 3 — Improvement opportunities')}

Cover: frequency, success rate, rollbacks, environment patterns, and trends. Use markdown.`
      );
      res.json({ digest: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/cost-explain
  router.post('/cost-explain', async (req: Request, res: Response) => {
    const { service, trend } = req.body as { service?: string; trend?: unknown[] };
    if (!service || !trend?.length) { res.status(400).json(problemDetails(400, 'Bad request', 'service and trend required')); return; }
    try {
      const csvContent = typeof trend[0] === 'string' ? trend[0].slice(0, 12000) : JSON.stringify(trend.slice(0, 30));
      const text = await invoke(
        `You are a FinOps engineer analyzing an AWS Cost Explorer export for "${service}".

CSV data:
${csvContent}

${SCENARIO_FOOTER.replace('Scenario 1', 'Scenario 1 — Current spending patterns').replace('Scenario 2', 'Scenario 2 — Cost anomalies and spikes').replace('Scenario 3', 'Scenario 3 — Optimization opportunities')}

Reference actual service names and cost values from the data. For optimizations suggest specific actions (Reserved Instances, Savings Plans, rightsizing, idle resource cleanup). Use markdown.`
      );
      res.json({ explanation: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/cve-triage
  router.post('/cve-triage', async (req: Request, res: Response) => {
    const { packageName, cves, services } = req.body as { packageName?: string; cves?: unknown[]; services?: string[] };
    if (!packageName || !cves) { res.status(400).json(problemDetails(400, 'Bad request', 'packageName and cves required')); return; }
    try {
      const data = JSON.stringify(cves.slice(0, 8));
      const context = services?.length ? ` for repository ${services[0]}` : '';
      const text = await invoke(
        `You are a security engineer triaging vulnerabilities${context}.

Vulnerability data (JSON):
${data}

${SCENARIO_FOOTER.replace('Scenario 1', 'Scenario 1 — Critical / immediate action required').replace('Scenario 2', 'Scenario 2 — High priority / fix within sprint').replace('Scenario 3', 'Scenario 3 — Medium / low priority / can defer')}

For each scenario list the specific packages and CVEs that fall into it, recommended action (upgrade to version X / apply patch / accept risk), and reasoning (CVSS score, KEV exploited status, severity counts). Use markdown.`
      );
      res.json({ triage: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/incident
  router.post('/incident', async (req: Request, res: Response) => {
    const { input } = req.body as { input?: string };
    if (!input) { res.status(400).json(problemDetails(400, 'Bad request', 'input is required')); return; }
    try {
      const text = await invoke(
        `You are a technical writer creating an incident report from raw data.

Input: ${input.slice(0, 2000)}

${SCENARIO_FOOTER.replace('Scenario 1', 'Scenario 1 — Most likely root cause').replace('Scenario 2', 'Scenario 2 — Contributing factors').replace('Scenario 3', 'Scenario 3 — Prevention / future mitigation')}

Also include before the scenarios: Title, Severity, Timeline (bullet list with times if available), Impact. Use markdown.`
      );
      res.json({ report: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/vuln-report
  // Body: { repoFullName, packages: VulnPackage[], cves: Record<pkgName, CveEntry[]> }
  router.post('/vuln-report', async (req: Request, res: Response) => {
    const { repoFullName, packages, cves } = req.body as {
      repoFullName?: string;
      packages?: Array<{ name: string; ecosystem: string; versions: string[]; criticalCount: number; highCount: number; mediumCount: number; lowCount: number; exploitedCount: number; }>;
      cves?: Record<string, Array<{ cveId: string; summary: string; severity: string; cvssScore: number | null; isKevExploited: boolean; }>>;
    };
    if (!repoFullName || !packages) {
      res.status(400).json(problemDetails(400, 'Bad request', 'repoFullName and packages are required'));
      return;
    }
    try {
      const pkgSummary = packages.map((p) => {
        const pkgCves = (cves?.[p.name] ?? []).slice(0, 5);
        const cveLines = pkgCves.map((c) =>
          `  - ${c.cveId} [${c.severity}${c.isKevExploited ? ', KEV-EXPLOITED' : ''}] CVSS:${c.cvssScore ?? 'N/A'} — ${c.summary.slice(0, 100)}`
        ).join('\n');
        return `${p.name}@${p.versions[0] ?? 'unknown'} (${p.ecosystem}) — CRITICAL:${p.criticalCount} HIGH:${p.highCount} MED:${p.mediumCount} LOW:${p.lowCount}${p.exploitedCount > 0 ? ` EXPLOITED:${p.exploitedCount}` : ''}\n${cveLines}`;
      }).join('\n\n');

      const text = await invoke(
        `You are a security engineer reviewing vulnerability scan results for the repository "${repoFullName}".

Scan data:
${pkgSummary.slice(0, 4000)}

Write a structured security report with:

## Executive Summary
2–3 sentences: overall risk posture, most urgent issues.

## Critical & Exploited Issues
List only CRITICAL severity or KEV-exploited CVEs. For each: package, CVE ID, what it allows an attacker to do, and exact fix (upgrade to version X).

## High Priority Fixes
High-severity CVEs worth addressing this sprint. Same format.

## Fix Plan
Ordered action list (1, 2, 3…) the team can follow this week. Include upgrade commands where possible (e.g. \`npm install package@x.y.z\`).

## Risk Acceptance
Any LOW/MEDIUM findings that are acceptable to defer, and why.

Use markdown. Be concise and actionable — engineers will act on this directly.`
      );
      res.json({ report: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/deployment-risk
  // Body: { owner, repo, prNumber, prTitle?, prBody?, prAuthor? }
  // The endpoint fetches PR files (and missing metadata) directly from GitHub —
  // shipping a 600-file diff through the client would blow past JSON body limits.
  router.post('/deployment-risk', async (req: Request, res: Response) => {
    const { owner, repo, prNumber } = req.body as {
      owner?: string;
      repo?: string;
      prNumber?: number;
      prTitle?: string;
      prBody?: string;
      prAuthor?: string;
    };
    let { prTitle, prBody, prAuthor } = req.body as {
      prTitle?: string;
      prBody?: string;
      prAuthor?: string;
    };
    if (!owner || !repo || !prNumber) {
      res.status(400).json(problemDetails(400, 'Bad request', 'owner, repo, and prNumber are required'));
      return;
    }
    try {
      const octokit = getOctokit();

      if (!prTitle || !prAuthor || prBody === undefined) {
        const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
        prTitle  = prTitle  ?? pr.title;
        prBody   = prBody   ?? pr.body ?? undefined;
        prAuthor = prAuthor ?? pr.user?.login ?? 'unknown';
      }

      const allFiles = await fetchPrFiles(octokit, owner, repo, prNumber);
      const totalFiles = allFiles.length;
      const totalAdditions = allFiles.reduce((s, f) => s + (f.additions ?? 0), 0);
      const totalDeletions = allFiles.reduce((s, f) => s + (f.deletions ?? 0), 0);

      // Group by top-level directory so the model sees the change footprint without
      // having to enumerate 600 filenames. Each row captures the file count and
      // line-change volume for one area of the codebase.
      type Bucket = { count: number; additions: number; deletions: number };
      const byArea = new Map<string, Bucket>();
      for (const f of allFiles) {
        const top = f.filename.split('/')[0] || '<root>';
        const e = byArea.get(top) ?? { count: 0, additions: 0, deletions: 0 };
        e.count++; e.additions += f.additions; e.deletions += f.deletions;
        byArea.set(top, e);
      }
      const areaLines = [...byArea.entries()]
        .sort((a, b) => (b[1].additions + b[1].deletions) - (a[1].additions + a[1].deletions))
        .map(([area, e]) => `| ${area} | ${e.count} | +${e.additions} / -${e.deletions} |`)
        .join('\n');

      // Group by file extension to surface the change mix (e.g. "lots of .gradle
      // and .swift" → native build changes; "package.json + lockfile" → deps).
      const byExt = new Map<string, number>();
      for (const f of allFiles) {
        const m = /\.([^.\/]+)$/.exec(f.filename);
        const ext = m ? m[1]! : '<no-ext>';
        byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
      }
      const extLines = [...byExt.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([ext, n]) => `${ext}:${n}`)
        .join(', ');

      // Pick the highest-impact files for patch excerpts. Sorting by line volume
      // surfaces the substantive changes (config, schemas, big migrations) and
      // pushes generated/scaffolding files to the bottom.
      const PATCHED_LIMIT = 50;
      const rankedFiles = [...allFiles].sort(
        (a, b) => (b.additions + b.deletions) - (a.additions + a.deletions),
      );
      const patchedFiles = rankedFiles.slice(0, PATCHED_LIMIT);

      const fileLines = patchedFiles.map((f) =>
        `| ${f.filename} | ${f.status} | +${f.additions}/-${f.deletions} | ${(f.patch ?? '').slice(0, 200).replace(/\n/g, ' ').trim()} |`
      ).join('\n');

      const scopeFloor = `\n\nScope-based risk floor (apply BEFORE reading the diff):
- ${totalFiles} files changed, +${totalAdditions} / -${totalDeletions} lines.
- A PR touching >100 files, or whose title indicates a major framework/runtime upgrade (e.g. "React Native", "Node major", "new architecture", "v2 → v3"), MUST NOT be rated 🟢 Low for Overall Risk or Blast Radius. Such changes carry inherent platform-wide risk regardless of how routine each individual diff looks.
- If you rate Overall Risk Low on a PR with >100 files, you must justify why this is not a framework/dependency upgrade in the Reason column.`;

      const text = await invoke(
        `You are a senior staff engineer performing a thorough pre-deployment risk assessment for a pull request.

Repository: ${owner}/${repo}
PR #${prNumber}: "${prTitle}"
Author: ${prAuthor}
Description: ${(prBody ?? 'No description provided.').slice(0, 800)}

Scope: ${totalFiles} files changed, +${totalAdditions} / -${totalDeletions} lines.${scopeFloor}

Change footprint by area (top-level directory):
| Area | Files | Lines Δ |
|---|---|---|
${areaLines || '| (none) | 0 | 0 |'}

File-type mix: ${extLines || '(unknown)'}

Highest-impact files (top ${PATCHED_LIMIT} by line volume — filename | status | diff | patch excerpt):
${fileLines || 'No files available'}

NOTE: The patch excerpts above cover only the largest ${Math.min(PATCHED_LIMIT, totalFiles)} of ${totalFiles} files. Use the "footprint by area" table for blast-radius reasoning across the full change set — do NOT assume the patch sample is the whole PR.

Produce a structured deployment risk report in EXACTLY this markdown format:

## Risk Assessment

| Category | Level | Reason |
|---|---|---|
| Overall Risk | 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical | one-line justification |
| Code Complexity | 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical | one-line justification |
| Blast Radius | 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical | one-line justification |
| Deployment Safety | 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical | one-line justification |
| Rollback Ease | 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical | one-line justification |

Use ONLY the emoji risk levels listed above. Fill every row.

## What This PR Does
2-3 sentence plain-language summary of what this change accomplishes.

## Change Areas Analysis

| Area | Change Type | Risk Signal | Notes |
|---|---|---|---|

One row per area from the footprint table above (NOT per file). At most 12 rows. Change Type: feat/fix/refactor/config/test/infra/deps/native. Risk Signal: Low/Medium/High/Critical. Notes column should explain *why* this area is risky or safe in 1 short sentence — reference specific concerns, not filenames. Do NOT enumerate individual files; the reader has GitHub for that.

## Deployment Recommendations

| Recommendation | Priority | Why |
|---|---|---|

List concrete actions before and after merging.

## Reviewer Checklist

| Check | Priority |
|---|---|
| [ ] item | High/Medium/Low |

List 4-6 specific verification items.

## Go / No-Go
State one of: **GO** / **GO WITH CONDITIONS** (list conditions inline) / **NO-GO** (list blockers inline)

Be direct, concrete, and actionable. Do not include any text outside these sections.`,
        3000
      );
      res.json({ report: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/pr-risk
  // Body: { repoFullName, prNumber, prTitle, prBody, author, additions, deletions, changedFiles, fileSummaries }
  router.post('/pr-risk', async (req: Request, res: Response) => {
    const { repoFullName, prNumber, prTitle, prBody, author, additions, deletions, changedFiles, fileSummaries } = req.body as {
      repoFullName?: string;
      prNumber?: number;
      prTitle?: string;
      prBody?: string;
      author?: string;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
      fileSummaries?: string[];
    };
    if (!repoFullName || !prNumber || !prTitle) {
      res.status(400).json(problemDetails(400, 'Bad request', 'repoFullName, prNumber, and prTitle are required'));
      return;
    }
    try {
      const fileList = (fileSummaries ?? []).slice(0, 50).join('\n');
      const text = await invoke(
        `You are a senior engineer performing a risk assessment for a pull request before it is merged.

Repository: ${repoFullName}
PR #${prNumber}: "${prTitle}"
Author: ${author ?? 'unknown'}
Changes: +${additions ?? 0} / -${deletions ?? 0} across ${changedFiles ?? 0} files
Description: ${(prBody ?? 'No description provided.').slice(0, 500)}

Files changed:
${fileList || 'Not available'}

Produce a structured risk assessment:

## Risk Level
One of: 🟢 Low / 🟡 Medium / 🔴 High / 🚨 Critical — with a one-line justification.

## What This PR Does
Concise technical summary of the changes (2–3 sentences).

## Risk Factors
Bullet list of specific risks: security, data integrity, performance, breaking changes, missing tests, infrastructure impact. Only include real concerns — do not hallucinate issues.

## Deployment Considerations
Anything the team should do before/after merging: feature flags, DB migrations, cache invalidation, coordinated deploys, rollback plan.

## Reviewer Checklist
3–5 specific things a reviewer should verify given these changes.

Use markdown. Be direct — no filler.`
      );
      res.json({ assessment: text });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/generate-runbook
  router.post('/generate-runbook', async (req: Request, res: Response) => {
    const { serviceName, serviceData, userPrompt } = req.body as {
      serviceName?: string;
      userPrompt?: string;
      serviceData?: {
        cluster?: string;
        cpu?: string;
        memory?: string;
        currentRunning?: number | null;
        autoScaling?: { min?: number | null; max?: number | null; scalesAt?: string };
        envVars?: Array<{ name: string; value: string }>;
        dependencies?: string[];
        rdsInstances?: string[];
        teamName?: string | null;
        repoUrl?: string | null;
      };
    };

    if (!serviceName || !serviceData) {
      res.status(400).json(problemDetails(400, 'Bad request', 'serviceName and serviceData are required'));
      return;
    }

    try {
      const {
        cluster = 'unknown',
        cpu = 'unknown',
        memory = 'unknown',
        currentRunning = null,
        autoScaling = {},
        envVars = [],
        dependencies = [],
        rdsInstances = [],
        teamName = null,
        repoUrl = null,
      } = serviceData;
      const { min = null, max = null, scalesAt = 'CPU >= 70%' } = autoScaling;

      const sensitivePattern = /PASSWORD|SECRET|KEY|TOKEN|PASS/i;
      const safeEnvVars = envVars.filter((e) => !sensitivePattern.test(e.name));

      const envVarRows = safeEnvVars.length > 0
        ? safeEnvVars.map((e) => `| \`${e.name}\` | \`${e.value}\` | Inferred from variable name |`).join('\n')
        : '| — | — | No non-sensitive env vars |';

      const depRows = [
        ...dependencies.map((d) => `| ECS Service | ${d} | Downstream service dependency |`),
        ...rdsInstances.map((r) => `| RDS | ${r} | Database |`),
      ].join('\n') || '| — | — | No dependencies detected |';

      const customInstructions = userPrompt?.trim();

      const systemPrompt = customInstructions
        ? `You are a senior SRE writing production runbooks. The user has given you specific instructions for this runbook — follow them exactly and let them shape the structure and content. Do not fall back to a generic template. Use the service facts provided to fill in concrete values.

User instructions: ${customInstructions}`
        : undefined;

      const prompt = customInstructions
        ? `Write a production runbook in markdown for the following ECS Fargate service. Start with "# Runbook: ${serviceName}". Be concise and operational. Keep under 2500 tokens.

Service: ${serviceName}
Cluster: ${cluster}
CPU: ${cpu}
Memory: ${memory}
Currently running tasks: ${currentRunning ?? 'unknown'}
Auto-scaling: min=${min ?? 'unknown'}, max=${max ?? 'unknown'}, triggers at ${scalesAt}
Team: ${teamName ?? 'unknown'}
Repository: ${repoUrl ?? 'not specified'}
Dependencies: ${dependencies.length > 0 ? dependencies.join(', ') : 'none detected'}
RDS instances: ${rdsInstances.length > 0 ? rdsInstances.join(', ') : 'none detected'}
Non-sensitive env vars: ${safeEnvVars.map((e) => `${e.name}=${e.value}`).join(', ') || 'none'}`
        : `You are a senior SRE writing a production runbook for an ECS Fargate service running Node.js/SailsJS. Write clear, accurate, and immediately actionable content. Do not add filler or preamble.

Service: ${serviceName}
Cluster: ${cluster}
CPU: ${cpu}
Memory: ${memory}
Currently running tasks: ${currentRunning ?? 'unknown'}
Auto-scaling: min=${min ?? 'unknown'}, max=${max ?? 'unknown'}, triggers at ${scalesAt}
Team: ${teamName ?? 'unknown'}
Repository: ${repoUrl ?? 'not specified'}
Dependencies: ${dependencies.length > 0 ? dependencies.join(', ') : 'none detected'}
RDS instances: ${rdsInstances.length > 0 ? rdsInstances.join(', ') : 'none detected'}
Non-sensitive env vars: ${safeEnvVars.map((e) => `${e.name}=${e.value}`).join(', ') || 'none'}

Output ONLY the following markdown, filling in every section:

# Runbook: ${serviceName}

## Service Overview
| Property | Value |
|---|---|
| Team | ${teamName ?? 'unknown'} |
| Repository | ${repoUrl ?? 'not specified'} |
| Runtime | Node.js / SailsJS (ECS Fargate) |
| CPU | ${cpu} |
| Memory | ${memory} |
| Auto-scaling | min ${min ?? '?'} → max ${max ?? '?'} tasks, scales at ${scalesAt} |

## How to Restart
1. Force a new ECS deployment:
\`\`\`bash
aws ecs update-service --cluster ${cluster} --service ${serviceName} --force-new-deployment
\`\`\`
2. [Write 2–3 more numbered steps: watch deployment, verify health, confirm task count is stable]

## How to Scale Manually
[Explain how to set desired count. Include the exact CLI command using cluster=${cluster} and service=${serviceName}. Show current min/max.]

## Key Dependencies
| Type | Name | Purpose |
|---|---|---|
${depRows}

## Key Environment Variables
| Variable | Value | Purpose |
|---|---|---|
${envVarRows}

## Common Failure Modes
| Symptom | Likely Cause | First Action |
|---|---|---|
[Write 4–5 rows covering: high CPU/event loop blocking, OOM kill, downstream dependency timeout, DB connection exhaustion, task failing to start. Tailor to Node.js/SailsJS on ECS Fargate.]

## Health Checks
- Verify the service is healthy after restart using:
\`\`\`bash
aws ecs describe-services --cluster ${cluster} --services ${serviceName} --query 'services[0].{status:status,running:runningCount,desired:desiredCount}'
\`\`\`
- [Add 1–2 additional health check tips specific to this service type]

## Escalation
${teamName ? `Contact the **${teamName}** team.` : 'Contact the owning team.'}${repoUrl ? ` Repository: ${repoUrl}` : ''}

Keep the total under 2500 tokens. Be concise and operational.`;

      const content = await invoke(prompt, 2500, systemPrompt);
      res.json({ content });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  // POST /ai/campaign-revert-suggestions
  router.post('/campaign-revert-suggestions', async (req: Request, res: Response) => {
    const { name, description, targetUsers, channels, campaignStartDate, campaignDate, durationDays, revertDate, scalingChanges, resourceSnapshot } = req.body as {
      name?: string;
      description?: string;
      targetUsers?: number;
      channels?: string[];
      campaignStartDate?: string;
      campaignDate?: string;
      durationDays?: number;
      revertDate?: string;
      scalingChanges?: string;
      resourceSnapshot?: unknown[];
    };

    const startDate = campaignStartDate ?? campaignDate;

    if (!name || !startDate || durationDays === undefined || !revertDate) {
      res.status(400).json(problemDetails(400, 'Bad request', 'name, campaignStartDate, durationDays, and revertDate are required'));
      return;
    }

    try {
      const channelList = (channels ?? []).join(', ') || 'N/A';
      const resourceSnapshotText = resourceSnapshot && resourceSnapshot.length > 0
        ? `\nCurrent resource state at time of campaign (these are the values to revert TO after campaign ends):\n${JSON.stringify(resourceSnapshot, null, 2).slice(0, 2000)}`
        : '';

      const prompt = `You are a senior DevOps engineer creating a campaign revert plan. Generate a structured markdown report for reverting infrastructure changes made during a marketing campaign.

Campaign Name: ${name}
Description: ${(description ?? 'No description provided').slice(0, 500)}
Target Users: ${targetUsers ?? 'unknown'}
Channels: ${channelList}
Campaign Start Date: ${startDate}
Duration: ${durationDays} days
Revert Date: ${revertDate}
${scalingChanges ? `Known Scaling Changes: ${scalingChanges.slice(0, 500)}` : ''}${resourceSnapshotText}

Generate the following structured report:

## Campaign Revert Plan: ${name}

### Campaign Summary
| Detail | Value |
|---|---|
| Campaign Name | ${name} |
| Target Users | ${targetUsers ?? 'unknown'} |
| Channels | ${channelList} |
| Start Date | ${startDate} |
| Duration | ${durationDays} days |
| Revert Date | ${revertDate} |

### Resource Revert Table
If resource snapshot is provided above, use the current values as the REVERT TO values. Otherwise infer from campaign size.

| Service | Resource | Current Value (REVERT TO THIS) | Campaign Value (likely changed to) | Action |
|---|---|---|---|---|
[Fill with rows for each resource. For ECS: running count, min/max capacity, task CPU/memory. For Lambda: memory, timeout, concurrency.]

### Revert Checklist
| # | Action | Service | Expected State After Revert | Priority |
|---|---|---|---|---|
[Fill with ordered steps. Priority: 🔴 Critical / 🟡 Important / 🟢 Optional]

### Verification Steps
After reverting, verify:

| Check | How to Verify | Pass Criteria |
|---|---|---|
[Fill with 4-6 verification checks]

### Rollback Risk
| Risk | Likelihood | Mitigation |
|---|---|---|
[Fill with 3-4 risks]

Keep the total response concise and actionable. Use exact AWS CLI commands where helpful.`;

      const suggestions = await invoke(prompt, 2000);
      res.json({ suggestions });
    } catch (e) { err(res, e instanceof Error ? e.message : 'Failed'); }
  });

  return router;
}

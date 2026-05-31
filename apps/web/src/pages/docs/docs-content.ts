// ---------------------------------------------------------------------------
// Documentation content — all 12 sections
// ---------------------------------------------------------------------------

export interface DocsTopic {
  id: string;
  title: string;
  body: string;
  tips?: string[];
  link?: string;
}

export interface DocsSection {
  id: string;
  title: string;
  description: string;
  color: string; // tailwind gradient classes (from-X to-Y)
  icon: string;  // emoji
  topics: DocsTopic[];
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'Setup, navigation, and first steps on the platform.',
    color: 'from-slate-600 to-slate-800',
    icon: '🚀',
    topics: [
      {
        id: 'what-is-wep',
        title: 'What is WEP?',
        body: 'The Washmen Engineering Platform (WEP) is a unified internal tool for Washmen\'s product engineering organisation. It brings together everything your team needs to understand the state of the system in one place: which services exist and who owns them, what has been deployed and when, how fast the team is shipping, where costs are growing, and what vulnerabilities need attention. WEP is not a collection of separate dashboards bolted together — it is a single platform with distinct domain modules that share infrastructure, data models, and a common navigation shell.',
        tips: [
          'Every feature is designed to drive a decision or an action — there are no vanity metrics.',
          'The home hub gives you a summary of all domains and quick links to the most-used pages.',
          'The top nav groups features into domains: Observe, Act, Measure, Security, AI Studio, On Call, Notify, Infra, and Global.',
        ],
      },
      {
        id: 'connecting-aws',
        title: 'Connecting AWS',
        body: 'WEP authenticates with AWS through IAM Identity Center (SSO). Go to Settings → Account Connections and click "Connect AWS". This opens your organisation\'s AWS SSO login page in a new tab. Sign in with your Washmen corporate email, complete MFA if prompted, and return to WEP — the connection status will update automatically. Sessions last 8 hours. WEP shows a red banner when your session expires; click it to re-authenticate.\n\nFeatures that require an active AWS connection: Resource Inventory, Cost Overview and all sub-pages, JIT Database Access, Active Credentials, ECS Drift Cache, CloudFront, Route 53, Certificates, and Deployment Digest.',
        tips: [
          'Sessions last 8 hours — re-authenticate from Settings → Account Connections when you see the expired banner.',
          'MFA is required — have your authenticator app ready before clicking Connect.',
          'If the SSO tab opens but shows an error, confirm your IAM Identity Center user is assigned to the WEP permission set (ask your AWS admin).',
          'Your AWS username in Settings → Profile must exactly match your Identity Center username for auto-approval rules to work.',
        ],
        link: '/settings',
      },
      {
        id: 'connecting-github',
        title: 'Connecting GitHub',
        body: 'WEP uses GitHub OAuth to read repositories, pull request data, and organisation membership. Go to Settings → Account Connections and click "Connect GitHub". You will be redirected to GitHub to authorise the Washmen WEP OAuth application — click "Authorize". You are then redirected back to WEP and the connection status turns green.\n\nRequired scopes: repo (read-only), read:org. WEP never writes to your repositories. The token is stored server-side in your session and expires when you log out or after 8 hours of inactivity.\n\nFeatures that require GitHub: Service Catalog sync, PR Review, Release Notes, GitLeaks, npm Audit, Dep Upgrade Advisor, and Pipeline Health.',
        tips: [
          'You must be a member of the Washmen GitHub organisation — contact your team lead if access is denied.',
          'If you see "OAuth app not authorized", ask an org admin to approve the WEP app at github.com/organizations/washmen/settings/oauth_application_policy.',
          'Revoking WEP\'s access from your GitHub settings will break the connection — reconnect from Settings.',
          'The token is stored only in your server-side session — it is never exposed to the browser or logged.',
        ],
        link: '/settings',
      },
      {
        id: 'navigation-guide',
        title: 'Navigation Guide',
        body: 'The top-level navigation bar groups features into domains. Clicking a domain name opens a dropdown listing the pages inside it. The current page is highlighted in the sidebar. The home page (the hub) is always reachable by clicking the Washmen logo in the top-left corner.',
        tips: [
          'The hub shows a summary of every domain and quick links to the most commonly used pages.',
          'The current page is always highlighted in the left sidebar.',
          'Use the search bar on the hub to quickly jump to any feature.',
        ],
        link: '/',
      },
      {
        id: 'first-steps',
        title: 'First Steps Checklist',
        body: 'Before using most WEP features, complete these four setup steps to ensure full functionality including auto-approval rules, alert routing, and DORA metric breakdowns.',
        tips: [
          'Connect your AWS SSO credentials (Settings → AWS Connection).',
          'Connect your GitHub account (Settings → GitHub Connection).',
          'Set your department, role, and AWS username (Settings → Profile) — used by auto-approval rules.',
          'Check that your team exists and has the correct Slack channel configured (Settings → Teams).',
        ],
        link: '/settings',
      },
    ],
  },
  {
    id: 'observe',
    title: 'Observe',
    description: 'Dashboard, catalog, deployments, and service graph.',
    color: 'from-blue-500 to-cyan-500',
    icon: '🔭',
    topics: [
      {
        id: 'dashboard',
        title: 'Dashboard',
        body: 'The dashboard is the operational overview of your organisation. It shows recent deployment activity, open incidents, the latest platform announcement, and a quick-glance health summary per team. Every card is clickable and links to the relevant detail page. Use it as your morning check-in before starting work.',
        tips: [
          'Use it as your morning check-in before starting work.',
          'Every card is clickable and links to the relevant detail page.',
          'The announcement banner at the top shows the latest platform-wide message.',
        ],
        link: '/dashboard',
      },
      {
        id: 'errors',
        title: 'Errors',
        body: 'The errors page shows a live feed of application errors aggregated from your services. Errors are grouped by category and displayed with a count and first/last-seen timestamp. Click a category row to drill down into individual occurrences. Use the time range filter at the top to narrow results to the last hour, day, or week.',
        tips: [
          'Click a category row to drill down into individual occurrences.',
          'Use the time range filter to narrow to the last hour, day, or week.',
          'Errors are grouped by category with count and first/last-seen timestamps.',
        ],
        link: '/errors',
      },
      {
        id: 'catalog',
        title: 'Catalog',
        body: 'The service catalog is the single source of truth for every service in the Washmen engineering organisation. Search by service name, owning team, or runtime type. Clicking a service opens its detail page, which shows owner team, deployment history, infrastructure drift, linked AWS resources, and service dependencies.',
        tips: [
          'Search by service name, owning team, or runtime type.',
          'Service detail pages show upstream and downstream dependencies.',
          'Linked AWS resources include ECS services, Lambda functions, and RDS instances.',
        ],
        link: '/catalog',
      },
      {
        id: 'tech-radar',
        title: 'Tech Radar',
        body: 'The Tech Radar tracks the lifecycle of every technology used across Washmen engineering. It is organised into four rings: Adopt (proven, recommended), Trial (approved in limited contexts), Assess (under evaluation), and Hold (not recommended for new work). Click any blip to see the technology\'s name, ring, category, and placement rationale.',
        tips: [
          'Adopt — proven, recommended for all new work.',
          'Trial — promising, approved for use in limited contexts with team sign-off.',
          'Hold — not recommended for new work; existing usage should be migrated away.',
          'Click any blip to see the rationale behind the placement decision.',
        ],
        link: '/catalog/radar',
      },
      {
        id: 'service-graph',
        title: 'Service Graph',
        body: 'The service graph visualises dependencies between services as a directed graph. Each node is a service; each edge is a runtime dependency. Use it to understand the blast radius of a failing service or to plan a decomposition effort. The Coupling tab lists tightly coupled service pairs — a signal that services may need to be decoupled or merged.',
        tips: [
          'Use it to understand the blast radius of a failing service.',
          'The Coupling tab lists tightly coupled service pairs with unusually high dependency counts.',
          'High coupling is a signal that services may need to be decoupled or merged.',
        ],
        link: '/catalog/service-graph',
      },
      {
        id: 'drift-cache',
        title: 'Drift Cache',
        body: 'Drift Cache shows a pre-computed nightly comparison of ECS task definitions between staging and production. If a service shows drift, it means staging and production are running different container images or configurations. The background scanner refreshes this data every midnight. For up-to-date results outside the nightly window, use Deployments → Environment Compare for a live diff.',
        tips: [
          'Config drift is often a sign that a staging deployment succeeded but the production promotion was blocked or forgotten.',
          'Check the deployment history for a drifted service to understand why.',
          'For a live diff outside the nightly window, use Deployments → Environment Compare.',
        ],
        link: '/catalog/drift',
      },
      {
        id: 'deployments',
        title: 'Deployments',
        body: 'The deployments feed shows a real-time list of all deployment events across all services and environments. Filter by service, team, or environment. Click a deployment to see its full details including the commit SHA, the deploying user, and whether it succeeded or failed.',
        tips: [
          'Filter by service, team, or environment to narrow the feed.',
          'Failed deployments are highlighted in red with a link to the pipeline run.',
          'Click any deployment to see the full details including the commit SHA.',
        ],
        link: '/deployments',
      },
      {
        id: 'promotion',
        title: 'Promotion Tracker',
        body: 'The Promotion Tracker shows the current state of each service\'s deployment pipeline — which version is in staging, which is in production, and whether a promotion is pending or blocked. Use it to coordinate release trains and ensure staging deployments are promoted to production promptly.',
        tips: [
          'Shows which version is in staging vs. production for every service.',
          'Blocked promotions are highlighted — click to see the blocking reason.',
          'Use it to coordinate release trains across multiple services.',
        ],
        link: '/deployments/promotion',
      },
      {
        id: 'pipelines',
        title: 'Pipelines',
        body: 'The Pipelines page shows the health of your GitHub Actions CI/CD pipelines across all repositories. It highlights flaky pipelines, slow pipelines, and pipelines with a high failure rate. Use it to identify bottlenecks in your delivery pipeline and prioritise reliability improvements.',
        tips: [
          'Flaky pipelines are highlighted — they are a leading indicator of reliability issues.',
          'Slow pipelines increase lead time for changes and reduce deployment frequency.',
          'Click a pipeline to see its recent run history and average duration.',
        ],
        link: '/pipelines',
      },
    ],
  },
  {
    id: 'act',
    title: 'Act',
    description: 'Self-service portal, runbooks, and JIT access.',
    color: 'from-amber-500 to-orange-600',
    icon: '⚡',
    topics: [
      {
        id: 'action-catalog',
        title: 'Action Catalog',
        body: 'The action catalog lists all self-service operations that engineers can submit without raising a support ticket. Each operation is a defined workflow with an approval policy — some approve automatically based on your profile, others route to a team lead. Common operations include JIT database access, credential rotation, and environment configuration changes.',
        tips: [
          'Browse the catalog, select an operation, fill in the required parameters, and submit.',
          'You will receive a Slack notification when the request is approved or rejected.',
          'Auto-approval requires your AWS username to be set in Settings → Profile.',
        ],
        link: '/portal',
      },
      {
        id: 'my-requests',
        title: 'My Requests',
        body: 'My Requests shows all self-service requests you have submitted, with their current status (pending, approved, rejected, expired). Click a request to see the full audit trail, including who approved it and when.',
        tips: [
          'Click a request to see the full audit trail including approver and timestamp.',
          'Expired requests are requests that were not actioned within the approval window.',
          'Approved requests for JIT access show the active credential details.',
        ],
        link: '/portal/requests',
      },
      {
        id: 'database-allowlist',
        title: 'Database Allowlist',
        body: 'The database allowlist shows all currently active JIT database access grants — which engineer has access to which database, when the grant was issued, and when it expires. Access grants are automatically revoked when they expire.',
        tips: [
          'All grants are time-limited and automatically revoked on expiry.',
          'Use this page to audit who currently has database access.',
          'Submit a new JIT access request from the Action Catalog.',
        ],
        link: '/portal/jit-resources',
      },
      {
        id: 'active-credentials',
        title: 'Active Credentials',
        body: 'Active Credentials shows all live JIT sessions for the current user, including service credentials, database passwords, and API tokens issued through the self-service portal. Each row shows the credential type, target resource, and exact expiry timestamp.',
        tips: [
          'Each row shows the credential type, target resource, and exact expiry timestamp.',
          'Credentials are revoked automatically when they expire.',
          'Copy credentials directly from this page — they are never shown in plain text after the initial reveal.',
        ],
        link: '/portal/jit-sessions',
      },
      {
        id: 'runbook-studio',
        title: 'Runbook Studio',
        body: 'The Runbook Studio is a structured editor for operational runbooks. Each runbook is a series of numbered steps with free-text instructions and optional linked actions (ECS task restarts, Lambda invocations, Step Function triggers). Runbooks are versioned, linked to services, and referenced by the Incident tracker and the Runbook Assistant AI tool.',
        tips: [
          'Link runbooks to specific services so they appear in incident responses.',
          'Each step can have optional linked actions for one-click execution.',
          'The Runbook Assistant AI can guide you through executing a runbook step-by-step.',
        ],
        link: '/portal/runbooks',
      },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    description: 'Velocity metrics, costs, and sprint analytics.',
    color: 'from-emerald-500 to-teal-600',
    icon: '📊',
    topics: [
      {
        id: 'sprint-digest',
        title: 'Sprint Digest',
        body: 'Sprint Digest pulls a weekly summary of sprint progress from your project management tool (Linear or Jira). It shows completed, in-progress, and blocked items per team, along with a carry-over count. Use it to run a five-minute stand-up review without opening your project management tool.',
        tips: [
          'Shows completed, in-progress, and blocked items per team.',
          'Carry-over count highlights work that was not completed in the sprint.',
          'Use it to run a five-minute stand-up review without opening your PM tool.',
        ],
        link: '/measure/sprint',
      },
      {
        id: 'health-signals',
        title: 'Health Signals',
        body: 'Health Signals gives a combined view of three quality indicators: stale services (no deployment in more than 30 days), project health scores (derived from open issues and PR age), and quality trends (test coverage, lint errors, build failure rate). Use it as a weekly hygiene check to catch neglected services before they become incidents.',
        tips: [
          'Services with no deployment in 30+ days are flagged as stale.',
          'Project health scores are derived from open issues and PR age.',
          'Run this as a weekly hygiene check to catch neglected services early.',
        ],
        link: '/measure/health-signals',
      },
      {
        id: 'velocity',
        title: 'Velocity (DORA Metrics)',
        body: 'The Velocity dashboard shows DORA metrics for your organisation and per team: Deployment Frequency, Lead Time for Changes, Change Failure Rate, and Mean Time to Restore (MTTR). Click a team name to drill into that team\'s individual metrics and deployment history.',
        tips: [
          'Deployment Frequency — how often you ship to production.',
          'Lead Time for Changes — time from first commit to production.',
          'Change Failure Rate — percentage of deployments requiring a rollback or hotfix.',
          'MTTR — average time to recover from an incident.',
        ],
        link: '/velocity',
      },
      {
        id: 'costs',
        title: 'Costs',
        body: 'The Costs page shows your AWS spend for the current month by service and account, sourced directly from Cost Explorer. The bar chart shows daily spend broken down by service type. Use the date range filter to view a prior month.',
        tips: [
          'Sourced directly from AWS Cost Explorer — requires an active AWS connection.',
          'Use the date range filter to view prior months for trend analysis.',
          'The bar chart breaks down daily spend by service type.',
        ],
        link: '/costs',
      },
      {
        id: 'insights',
        title: 'Insights',
        body: 'Insights combines an executive summary with cost recommendations from the portfolio analyser. It highlights cost anomalies, idle resources, and over-provisioned services. Each recommendation includes an estimated monthly saving and a link to the affected resource in the AWS console.',
        tips: [
          'Each recommendation includes an estimated monthly saving.',
          'Links to affected resources in the AWS console for immediate action.',
          'Cost anomalies are highlighted when spend deviates significantly from the baseline.',
        ],
        link: '/costs/insights',
      },
      {
        id: 'comparison',
        title: 'Comparison',
        body: 'The Comparison page shows a month-over-month cost comparison across all services. Services with cost increases above the configured threshold are highlighted in red. Use it before each sprint planning session to spot runaway services before they become budget issues.',
        tips: [
          'Services with cost increases above the threshold are highlighted in red.',
          'Run this before sprint planning to catch runaway services early.',
          'Compare any two months using the month picker.',
        ],
        link: '/costs/comparison',
      },
      {
        id: 'budgets',
        title: 'Budgets',
        body: 'Budgets lets you set monthly spend thresholds per team or per service. When actual spend exceeds a budget threshold, WEP fires a cost_spike alert rule and posts a notification to the configured Slack channel. Budget thresholds are shared with the team and visible to all members.',
        tips: [
          'Set thresholds per team or per service.',
          'Exceeding a budget threshold fires the cost_spike alert rule automatically.',
          'Budget thresholds are visible to all team members.',
        ],
        link: '/costs/budgets',
      },
      {
        id: 'attribution',
        title: 'Attribution',
        body: 'Cost Attribution breaks down AWS spend grouped by the Service and Team resource tags applied to your AWS resources. This page is only useful if your team consistently tags resources when provisioning them. Check the Resource Inventory page for resources that are missing tags.',
        tips: [
          'Tag all AWS resources with at least Service, Team, Environment, and CostCenter for accurate attribution.',
          'Check Resource Inventory for resources that are missing required tags.',
          'Attribution data updates daily from Cost Explorer.',
        ],
        link: '/costs/attribution',
      },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    description: 'Vulnerability scanning, secrets, and audit.',
    color: 'from-indigo-600 to-violet-700',
    icon: '🔒',
    topics: [
      {
        id: 'sec-feed',
        title: 'Security Feed',
        body: 'The Security Feed is a live CVE and vulnerability feed for your organisation\'s repositories and dependencies. Vulnerabilities are sorted by severity (Critical, High, Medium, Low) and enriched with CVSS scores and links to the relevant advisory. Expand a row to see which services are affected and to create a Vuln Tracker item for remediation tracking.',
        tips: [
          'Vulnerabilities are sorted by severity with CVSS scores.',
          'Expand a row to see which services are affected.',
          'Create a Vuln Tracker item directly from any vulnerability row.',
        ],
        link: '/security',
      },
      {
        id: 'repositories',
        title: 'Repositories',
        body: 'The Repositories page shows a per-repo security posture — open vulnerability counts, secret scanning alerts, and whether Dependabot is enabled. Click a repo to see its full vulnerability list and dependency graph.',
        tips: [
          'Shows open vulnerability counts, secret scanning alerts, and Dependabot status per repo.',
          'Click a repo to see its full vulnerability list and dependency graph.',
          'Repos with Dependabot disabled are flagged as a security risk.',
        ],
        link: '/security/repos',
      },
      {
        id: 'gitleaks',
        title: 'GitLeaks',
        body: 'GitLeaks shows the results of secret scanning runs across all repositories. Each finding includes the file, line number, and type of secret detected. Findings are never shown in plain text — only the metadata is surfaced. Use this page to track which repos have unresolved secret findings and to assign remediation work.',
        tips: [
          'Findings show file, line number, and type of secret — never the actual secret value.',
          'Track which repos have unresolved findings and assign remediation work.',
          'Rotate any detected secrets immediately, even if the finding is old.',
        ],
        link: '/security/gitleaks',
      },
      {
        id: 'npm-audit',
        title: 'npm Audit',
        body: 'The npm Audit page aggregates npm vulnerability data across all repositories that have a package.json. The table shows each repo with its vulnerability count by severity. Click "Run Scan" to trigger a fresh scan of all repos immediately. Results are also refreshed nightly by the background scanner.',
        tips: [
          'Click "Run Scan" to trigger a fresh scan immediately.',
          'Results are refreshed nightly by the background scanner.',
          'Use the severity filter to focus on critical issues.',
        ],
        link: '/security/npm-audit',
      },
      {
        id: 'vuln-tracker',
        title: 'Vuln Tracker',
        body: 'Vuln Tracker is the remediation workflow for known vulnerabilities. Each tracker item has a status (Open, In Progress, Resolved, Accepted Risk), an assigned team, and an optional due date. Create items directly from the Security Feed by expanding a vulnerability row and clicking "Track".',
        tips: [
          'Create items directly from the Security Feed by clicking "Track".',
          'Statuses: Open, In Progress, Resolved, Accepted Risk.',
          'Update the status as work progresses to keep the security posture dashboard accurate.',
        ],
        link: '/security/vuln-tracker',
      },
    ],
  },
  {
    id: 'ai-studio',
    title: 'AI Studio',
    description: 'PR review, release notes, on-call briefing, and more.',
    color: 'from-pink-500 to-rose-600',
    icon: '🤖',
    topics: [
      {
        id: 'pr-review',
        title: 'PR Review',
        body: 'Paste a GitHub owner, repository name, and PR number to get an AI-powered code review. The review is focused on NodeJS/TypeScript patterns, security anti-patterns, and test coverage gaps. Results are streamed in real time as the AI processes the diff.',
        tips: [
          'Results are streamed in real time as the AI processes the diff.',
          'Focused on NodeJS/TypeScript patterns, security anti-patterns, and test coverage gaps.',
          'Useful for a second opinion before merging critical changes.',
        ],
        link: '/ai/pr-review',
      },
      {
        id: 'release-notes',
        title: 'Release Notes',
        body: 'Generate structured release notes from two commit SHAs or Git tags. The output is grouped into Features, Bug Fixes, and Breaking Changes. Copy the output directly into your release announcement or Confluence page.',
        tips: [
          'Input two commit SHAs or Git tags to define the release range.',
          'Output is grouped into Features, Bug Fixes, and Breaking Changes.',
          'Copy directly into your release announcement or Confluence page.',
        ],
        link: '/ai/release-notes',
      },
      {
        id: 'oncall-briefing',
        title: 'On-Call Briefing',
        body: 'One-click morning briefing for the engineer starting their on-call shift. It pulls live deployment data from the last 24 hours, any open incidents, and recent cost anomalies, and produces a concise summary so you can start your shift with full situational awareness without having to check five different tools.',
        tips: [
          'Pulls live deployment data, open incidents, and cost anomalies from the last 24 hours.',
          'Use it at the start of every on-call shift for full situational awareness.',
          'The briefing is generated fresh every time — no stale cached data.',
        ],
        link: '/ai/oncall-briefing',
      },
      {
        id: 'dep-upgrade-advisor',
        title: 'Dep Upgrade Advisor',
        body: 'Enter a package name (for example, axios or fastify) to see which repositories use it, at what version, and how far behind the latest release they are. The AI then produces migration guidance tailored to the version jump, referencing the package\'s changelog and known breaking changes.',
        tips: [
          'Shows all repos using the package and their current version.',
          'Migration guidance is tailored to the specific version jump.',
          'References the package changelog and known breaking changes.',
        ],
        link: '/ai/dep-advisor',
      },
      {
        id: 'runbook-assistant',
        title: 'Runbook Assistant',
        body: 'Ask natural language questions about your runbooks or request step-by-step execution guidance for a specific runbook. The assistant has access to all runbooks in the Runbook Studio and can reference the linked service\'s current state when generating guidance.',
        tips: [
          'Ask natural language questions like "how do I restart the orders service?"',
          'Has access to all runbooks in the Runbook Studio.',
          'Can reference the linked service\'s current state when generating guidance.',
        ],
        link: '/ai/runbook',
      },
      {
        id: 'deployment-digest',
        title: 'Deployment Digest',
        body: 'An AI-generated summary of recent deployment activity across all services. Useful for a quick catch-up after time off, or as a Monday morning briefing for the engineering leadership team. The digest highlights services with unusual deployment patterns, rollbacks, and long gaps between deployments.',
        tips: [
          'Highlights services with unusual deployment patterns and rollbacks.',
          'Use it as a Monday morning briefing for engineering leadership.',
          'Great for catching up after time off.',
        ],
        link: '/ai/digest',
      },
      {
        id: 'cve-triage',
        title: 'CVE Triage',
        body: 'Paste CVE details (CVE ID or full description) and get an AI analysis of which services in your catalog are likely affected based on their technology stack, and suggested remediation steps with priority ordering. Particularly useful for newly published zero-days where you need to quickly assess blast radius.',
        tips: [
          'Paste a CVE ID or full description to begin triage.',
          'Identifies affected services based on their technology stack.',
          'Suggested remediation steps are prioritised by risk.',
        ],
        link: '/ai/cve-triage',
      },
      {
        id: 'incident-scribe',
        title: 'Incident Scribe',
        body: 'Document an incident in natural language — describe what happened, the timeline, and the resolution — and get a structured post-mortem draft in return. The draft follows the standard Washmen post-mortem template and includes sections for impact, root cause, contributing factors, action items, and lessons learned.',
        tips: [
          'Describe the incident in natural language — no structured input required.',
          'Output follows the standard Washmen post-mortem template.',
          'Includes impact, root cause, contributing factors, action items, and lessons learned.',
        ],
        link: '/ai/incident',
      },
    ],
  },
  {
    id: 'on-call',
    title: 'On Call',
    description: 'Incident management and rotation schedules.',
    color: 'from-red-500 to-rose-600',
    icon: '🚨',
    topics: [
      {
        id: 'incidents',
        title: 'Incidents',
        body: 'Open, track, and resolve incidents from a single page. Each incident has a severity level (P1–P4), an assigned team, a linked service, and an optional linked runbook. Use the timeline within an incident to log updates as the situation evolves — the timeline is automatically included in post-mortem exports.',
        tips: [
          'P1 — production down, data loss, or security breach. Wake people up.',
          'P2 — significant degradation affecting multiple users or teams.',
          'Resolving a P1 or P2 incident automatically prompts you to create a Vuln Tracker item if a security component was involved.',
          'The incident timeline is automatically included in post-mortem exports.',
        ],
        link: '/on-call/incidents',
      },
      {
        id: 'schedule',
        title: 'Schedule',
        body: 'The Schedule page holds the weekly on-call rotation per team. Enter the primary and secondary (backup) engineers for each week. The Monday 9am Slack notification reads from this data to post the current week\'s on-call roster to the team channel — keep it up to date to ensure engineers know who to page.',
        tips: [
          'Keep the schedule up to date so engineers know who to page.',
          'The Monday 9am Slack notification reads directly from this data.',
          'Enter both a primary and a secondary (backup) engineer for each week.',
        ],
        link: '/on-call/schedule',
      },
    ],
  },
  {
    id: 'notify',
    title: 'Notify',
    description: 'Alert rules, broadcasts, and team subscriptions.',
    color: 'from-yellow-400 to-amber-500',
    icon: '🔔',
    topics: [
      {
        id: 'announcements',
        title: 'Announcements',
        body: 'Publish platform-wide announcements to all WEP users. Choose a severity level (Critical, Warning, Info) and write the message body. On publish, the announcement is displayed in the WEP dashboard banner and automatically posted to the #announcements Slack channel.',
        tips: [
          'Choose Critical, Warning, or Info severity.',
          'Announcements appear in the WEP dashboard banner for all users.',
          'Automatically posted to the #announcements Slack channel on publish.',
        ],
        link: '/announcements',
      },
      {
        id: 'broadcast-templates',
        title: 'Broadcast Templates',
        body: 'Create reusable message templates for recurring communication needs: incident notifications, maintenance windows, release announcements, and general updates. Templates support variable placeholders (for example, {{service_name}} or {{start_time}}). Hitting "Send" immediately posts the filled-in template to the appropriate Slack channel.',
        tips: [
          'Templates support variable placeholders like {{service_name}} and {{start_time}}.',
          'Hitting "Send" immediately posts the filled-in template to the Slack channel.',
          'Create templates for common recurring messages: maintenance windows, release announcements.',
        ],
        link: '/notify/broadcasts',
      },
      {
        id: 'weekly-digest',
        title: 'Weekly Digest',
        body: 'The Weekly Digest provides a summary of the last seven days of deployment activity across all services. It can be generated on demand from this page, or configured to run automatically every Friday at 5pm Gulf time by creating an Alert Rule with condition weekly_digest.',
        tips: [
          'Generate on demand from this page, or configure it to run automatically.',
          'Configure automatic delivery by creating an Alert Rule with condition weekly_digest.',
          'Automatic delivery fires every Friday at 5pm Gulf time.',
        ],
        link: '/notify/weekly-digest',
      },
      {
        id: 'alert-rules',
        title: 'Alert Rules',
        body: 'Alert Rules are the core alerting engine. Each rule has a condition, a Slack channel target, and an optional threshold. Supported conditions include deploy_failed, p1_incident, cost_spike, critical_vuln, config_drift, weekly_digest, and oncall_shift. Rules fire automatically when their condition is met.',
        tips: [
          'deploy_failed — fires within 5 minutes of a failed deployment.',
          'cost_spike — fires hourly if monthly spend has increased by more than the configured threshold (default 20%).',
          'config_drift — fires every 30 minutes if staging and production ECS task definitions differ.',
          'oncall_shift — fires every Monday at 9am Gulf time and posts the current week\'s on-call roster.',
        ],
        link: '/notify/alert-rules',
      },
      {
        id: 'subscriptions',
        title: 'Subscriptions',
        body: 'Subscriptions allow individual engineers to receive Slack DMs for specific services. When you subscribe to a service, WEP sends you a direct message whenever that service has a failed deployment or config drift. Subscriptions work independently of team-level alert rules.',
        tips: [
          'A matching alert rule for deploy_failed or config_drift must also be enabled for the notification to fire.',
          'Subscriptions work independently of team-level alert rules.',
          'If DMs are not arriving, check that your GitHub username is listed in the correct team.',
        ],
        link: '/notify/subscriptions',
      },
    ],
  },
  {
    id: 'infra',
    title: 'Infra',
    description: 'Cloud resource inventory and visibility.',
    color: 'from-cyan-600 to-blue-700',
    icon: '🏗️',
    topics: [
      {
        id: 'resource-inventory',
        title: 'Resource Inventory',
        body: 'Resource Inventory gives you a searchable, filterable list of AWS resources across all your accounts: ECS services, Lambda functions, RDS instances, S3 buckets, and more. Filter by resource type or by the Service tag to find everything that belongs to a specific service. Resources with missing required tags are highlighted in amber.',
        tips: [
          'Filter by resource type or by the Service tag.',
          'Resources with missing required tags are highlighted in amber.',
          'Required tags are: Service, Team, Environment, and CostCenter.',
        ],
        link: '/infra/resources',
      },
    ],
  },
  {
    id: 'global',
    title: 'Global',
    description: 'CloudFront, DNS, and certificates.',
    color: 'from-sky-400 to-blue-500',
    icon: '🌐',
    topics: [
      {
        id: 'cloudfront',
        title: 'CloudFront',
        body: 'View all CloudFront distributions across your AWS accounts. Each row shows the distribution domain, the origin (S3 bucket or ALB), enabled cache behaviours, and whether a WAF is attached. Use this page to audit CDN configuration before a major frontend release.',
        tips: [
          'Check WAF attachment status for every distribution.',
          'Use before a major frontend release to audit CDN configuration.',
          'Shows origin (S3 bucket or ALB) and enabled cache behaviours.',
        ],
        link: '/global/distributions',
      },
      {
        id: 'route53',
        title: 'Route 53 DNS',
        body: 'Browse all Route 53 hosted zones and their DNS records. Filter by zone or record type. Useful when debugging routing issues or verifying that a new domain record has propagated correctly.',
        tips: [
          'Filter by zone or record type to narrow the list.',
          'Useful for debugging routing issues after a deployment.',
          'Verify that new domain records have propagated correctly.',
        ],
        link: '/global/dns',
      },
      {
        id: 'certificates',
        title: 'Certificates',
        body: 'The Certificates page lists all ACM certificates with their domain name, status, and expiry date. Certificates expiring within 30 days are highlighted in amber; those expiring within 7 days are highlighted in red. ACM auto-renews certificates automatically, but this page lets you confirm renewal has succeeded.',
        tips: [
          'Amber: expiring within 30 days. Red: expiring within 7 days.',
          'ACM auto-renews certificates, but use this page to confirm renewal succeeded.',
          'A certificate stuck in "Pending validation" requires DNS record action.',
        ],
        link: '/global/certificates',
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Profile, credentials, and team management.',
    color: 'from-gray-500 to-gray-700',
    icon: '⚙️',
    topics: [
      {
        id: 'profile',
        title: 'Profile',
        body: 'Set your department, role, and AWS username. The AWS username is matched against IAM Identity Center to pre-populate auto-approval rules in the self-service portal — if it is missing or incorrect, some operations that should auto-approve will be routed to a manual reviewer instead.',
        tips: [
          'The AWS username must match your IAM Identity Center username exactly.',
          'A missing or incorrect username routes auto-approve operations to a manual reviewer.',
          'Department and role are used for access policy evaluation in the self-service portal.',
        ],
        link: '/settings',
      },
      {
        id: 'aws-connection',
        title: 'AWS Connection',
        body: 'Connect your AWS SSO session. Clicking "Connect" opens an AWS SSO sign-in window in a new tab. After signing in, return to this tab and click "Verify". The connection status and session expiry time are shown on this page. All AWS-backed features require an active AWS connection.',
        tips: [
          'Sessions last 8 hours — WEP shows a banner when your session expires.',
          'Re-authenticate from this page whenever you see a "credentials expired" banner.',
          'All AWS-backed features require an active session: infra inventory, cost data, ECS drift, JIT access.',
        ],
        link: '/settings',
      },
      {
        id: 'github-connection',
        title: 'GitHub Connection',
        body: 'Connect your GitHub account by authorising the WEP OAuth application in the Washmen GitHub organisation. A personal access token is generated with the minimum required scopes (repo:read, org:read). This token is stored only in your browser session and is never sent to any external service.',
        tips: [
          'Authorise the WEP OAuth application — minimum required scopes only.',
          'The token is stored only in your browser session and never sent externally.',
          'Required for: service catalog sync, PR Review, npm Audit, and GitLeaks.',
        ],
        link: '/settings',
      },
      {
        id: 'teams',
        title: 'Teams',
        body: 'Manage team definitions for your engineering organisation. Each team has an ID, a display name, a Slack channel, and a list of member GitHub usernames. Teams are referenced throughout the platform for ownership attribution, alert routing, and DORA metric breakdowns. Keep team membership up to date so that ownership data in the service catalog remains accurate.',
        tips: [
          'Each team needs a display name, Slack channel, and list of member GitHub usernames.',
          'If Slack DMs for subscriptions are not arriving, check that the member\'s GitHub username is listed here.',
          'Teams are referenced for ownership attribution, alert routing, and DORA metric breakdowns.',
        ],
        link: '/settings/teams',
      },
    ],
  },
  {
    id: 'platform-setup',
    title: 'Platform Setup',
    description: 'AWS Identity Center, GitHub OAuth app, and environment configuration for admins.',
    color: 'from-slate-700 to-zinc-800',
    icon: '🛠️',
    topics: [
      {
        id: 'aws-identity-center-setup',
        title: 'AWS IAM Identity Center Setup',
        body: 'WEP requires an IAM Identity Center (formerly AWS SSO) instance in your AWS Organisation management account. Follow these steps as an AWS admin:\n\n1. Open the AWS Console → IAM Identity Center → Enable. Choose "Enable with AWS Organizations" if you have a multi-account setup.\n\n2. Under "Applications", click "Add application" → "Add custom SAML 2.0 application" (or use the built-in OAuth flow). Set the application name to "Washmen Engineering Platform".\n\n3. Under "Permission sets", create a new permission set named "WEP-ReadOnly". Attach the following managed policies: ReadOnlyAccess, AWSCostExplorerReadOnlyAccess, AmazonDynamoDBReadOnlyAccess. This is the minimum required for most WEP features.\n\n4. For JIT database access, create a second permission set named "WEP-JIT-DBAccess" with: AmazonRDSDataFullAccess scoped to specific resource ARNs.\n\n5. Assign users or groups from your identity provider (Okta, Azure AD, or the built-in Identity Center directory) to both permission sets for the target AWS accounts.\n\n6. Note down the "AWS SSO Start URL" (e.g. https://washmen.awsapps.com/start) — set this as the SSO_START_URL environment variable in the WEP API.\n\n7. Set SSO_REGION to the region where Identity Center is enabled (e.g. eu-west-1).',
        tips: [
          'IAM Identity Center must be enabled in the AWS Organization management account — it cannot be enabled in a member account.',
          'The SSO start URL format is: https://<your-subdomain>.awsapps.com/start — find it in Identity Center → Settings → Identity source.',
          'Users must be assigned to at least the WEP-ReadOnly permission set to authenticate successfully.',
          'Set MFA to "Required" in Identity Center → Settings → MFA for all users before enabling SSO login.',
          'If using an external IdP (Okta/Azure AD), configure automatic provisioning (SCIM) to keep users and groups in sync.',
        ],
      },
      {
        id: 'github-oauth-app-setup',
        title: 'GitHub OAuth App Setup',
        body: 'WEP uses a GitHub OAuth App (not a GitHub App) for user authentication and repository access. Follow these steps as a GitHub Organisation admin:\n\n1. Go to github.com/organizations/washmen/settings/applications → "OAuth Apps" → "New OAuth App".\n\n2. Fill in the fields:\n   - Application name: Washmen Engineering Platform\n   - Homepage URL: https://your-wep-domain.washmen.com\n   - Authorization callback URL: https://your-wep-domain.washmen.com/api/v1/oauth/github/callback\n\n3. Click "Register application". On the next page, click "Generate a new client secret".\n\n4. Copy the Client ID and Client Secret into the WEP API environment variables:\n   - GITHUB_CLIENT_ID=<your-client-id>\n   - GITHUB_CLIENT_SECRET=<your-client-secret>\n\n5. Under Organisation settings → OAuth application policy, approve the WEP application so that org members can authorize it without individual admin approval.\n\n6. If your organisation has SAML SSO enforced, the OAuth token must also be SAML-authorised. In the OAuth app settings, click "Authorize" next to your organisation name — otherwise users will get a 403 when the app tries to read org membership.',
        tips: [
          'Use an OAuth App, not a GitHub App — the OAuth flow is simpler and WEP does not need webhook delivery.',
          'The callback URL must exactly match what is set in the GitHub app, including the protocol (https) and no trailing slash.',
          'If org SAML SSO is enforced, the app must be SAML-authorized from the OAuth app settings page — otherwise all org:read calls return 403.',
          'Rotate the client secret every 90 days and update the GITHUB_CLIENT_SECRET environment variable in the API.',
          'Do not commit the client secret to source control — store it in AWS Secrets Manager and inject it at runtime.',
        ],
      },
      {
        id: 'api-environment-variables',
        title: 'API Environment Variables',
        body: 'The WEP API reads the following environment variables at startup. All secrets should be stored in AWS Secrets Manager and injected by the ECS task definition — do not hardcode them in source control.\n\nRequired for core functionality:\n- AWS_REGION — AWS region (e.g. eu-west-1)\n- DYNAMODB_TABLE_PREFIX — prefix for DynamoDB tables (e.g. wep)\n- SESSION_SECRET — a random 64-character string used to sign session cookies\n- REDIS_URL — Redis connection URL for session storage (e.g. redis://localhost:6379)\n\nRequired for AWS SSO:\n- SSO_START_URL — your Identity Center start URL\n- SSO_REGION — region where Identity Center is enabled\n- AWS_SSO_CLIENT_ID — registered SSO client ID (obtained from IAM Identity Center → Applications)\n- AWS_SSO_CLIENT_SECRET — registered SSO client secret\n\nRequired for GitHub OAuth:\n- GITHUB_CLIENT_ID — from the GitHub OAuth App settings\n- GITHUB_CLIENT_SECRET — from the GitHub OAuth App settings\n\nRequired for Slack:\n- SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-...)\n- SLACK_ANNOUNCEMENTS_CHANNEL — e.g. #announcements\n- SLACK_UPDATES_CHANNEL — e.g. #engineering-updates\n\nOptional:\n- FRONTEND_URL — full URL of the WEP frontend (used in Slack links, e.g. https://wep.washmen.com)\n- NODE_ENV — set to "production" in all deployed environments',
        tips: [
          'Never commit secrets to source control — use AWS Secrets Manager and inject via ECS task definition secrets.',
          'SESSION_SECRET must be at least 32 characters and randomly generated — use: openssl rand -hex 32',
          'REDIS_URL should point to an ElastiCache Redis cluster in production, not a local instance.',
          'Rotate GITHUB_CLIENT_SECRET and SESSION_SECRET every 90 days.',
          'Set NODE_ENV=production — this disables stack traces in error responses and enables production-safe logging.',
        ],
      },
      {
        id: 'dynamodb-table-setup',
        title: 'DynamoDB Table Provisioning',
        body: 'WEP uses one DynamoDB table per domain, created automatically by running the create-tables script. Run this once after deploying the API to a new environment:\n\n  cd apps/api\n  pnpm create-tables\n\nThis creates all required tables with the naming convention wep-<domain>-<environment> (e.g. wep-service-catalog-development). Each table uses PAY_PER_REQUEST billing and includes a GSI (GSI1PK/GSI1SK) for secondary access patterns.\n\nTables created: service-catalog, deployment-tracker, velocity-metrics, pipeline-analytics, cost-intelligence, self-service, security, teams, npm-audit, ci-cost, on-call, notify, drift-cache, announcements, blog, env-config, postmortems, dep-health, changelog, licenses.\n\nTo target a specific environment, set the ENVIRONMENT variable:\n  ENVIRONMENT=production pnpm create-tables\n\nThe default environment is "development". Tables are idempotent — running the script again on an existing environment is safe.',
        tips: [
          'Run create-tables once per environment (development, staging, production).',
          'Tables are idempotent — re-running the script will skip tables that already exist.',
          'Use PAY_PER_REQUEST in all environments — do not switch to provisioned capacity unless you have a specific throughput requirement.',
          'Enable DynamoDB Point-in-Time Recovery (PITR) on all production tables for data safety.',
          'Set a TTL attribute on the deduplication and drift-cache tables to automatically expire old records.',
        ],
      },
      {
        id: 'redis-session-setup',
        title: 'Redis Session Store',
        body: 'WEP stores user sessions (AWS SSO tokens, GitHub tokens) in Redis so they survive API restarts. In development, a local Redis instance is sufficient. In production, use AWS ElastiCache (Redis 7.x, cluster mode disabled for simplicity).\n\nLocal development:\n  docker run -d -p 6379:6379 redis:7-alpine\n  Set REDIS_URL=redis://localhost:6379 in your .env file.\n\nProduction (ElastiCache):\n1. Create an ElastiCache Redis cluster in the same VPC as the ECS service.\n2. Enable in-transit encryption (TLS) and at-rest encryption.\n3. Set REDIS_URL=rediss://<cluster-endpoint>:6379 (note the "rediss://" scheme for TLS).\n4. Ensure the ECS task\'s security group has outbound access to the ElastiCache security group on port 6379.\n\nSession TTL is set to 8 hours by default, matching the AWS SSO session duration. Sessions are automatically cleaned up by Redis TTL — no manual purge is needed.',
        tips: [
          'Use "rediss://" (with double-s) for TLS connections to ElastiCache in production.',
          'Place ElastiCache in the same VPC and AZ as the ECS service to minimise latency.',
          'Enable automatic backups on the ElastiCache cluster — sessions are lost on failover without a replica.',
          'Do not share the Redis instance with other applications — WEP\'s session keys could conflict.',
          'Session TTL is 8 hours — matches the AWS SSO token expiry. No configuration needed.',
        ],
      },
    ],
  },
  {
    id: 'blog',
    title: 'Blog',
    description: 'Writing, publishing, and sharing engineering posts.',
    color: 'from-teal-500 to-emerald-600',
    icon: '✍️',
    topics: [
      {
        id: 'reading-posts',
        title: 'Reading Posts',
        body: 'The Blog lists all published engineering posts in reverse chronological order. Posts are tagged by topic (e.g. infrastructure, performance, security) for easy filtering. Click a post title to read it in full. Use the Blog as a living knowledge base — search for posts about specific technologies or incidents to benefit from past learnings.',
        tips: [
          'Posts are tagged by topic for easy filtering.',
          'Use the Blog as a living knowledge base for past learnings.',
          'Click a post title to read it in full-page view.',
        ],
        link: '/blog',
      },
      {
        id: 'writing-a-post',
        title: 'Writing a Post',
        body: 'Click "New Post" to open the blog editor. Write your post in Markdown — the editor provides a live preview alongside your text. Add a title, a summary, and one or more tags before publishing. Save drafts at any time; drafts are visible only to you until published.',
        tips: [
          'The editor provides a live Markdown preview alongside your text.',
          'Drafts are visible only to you until you publish.',
          'Add a title, summary, and tags before publishing for discoverability.',
        ],
        link: '/blog/new',
      },
      {
        id: 'publishing',
        title: 'Publishing & Slack Delivery',
        body: 'Hitting "Publish" makes the post visible to the entire engineering organisation and automatically posts a notification to the #engineering-blog Slack channel with the post title, author, and a link. Choose the correct tags before publishing — they are used to route the notification to additional topic-specific channels.',
        tips: [
          'Publishing automatically notifies the #engineering-blog Slack channel.',
          'Choose correct tags before publishing — they route to topic-specific Slack channels.',
          'Posts cannot be un-published once live — edit them instead.',
        ],
        link: '/blog',
      },
      {
        id: 'tags-discovery',
        title: 'Tags & Discovery',
        body: 'Tags are the primary discovery mechanism for blog posts. Use consistent, lowercase, hyphenated tags (e.g. aws, node-js, incident-review, cost-optimisation). The blog index page shows all tags in use and lets you filter by one or more tags simultaneously.',
        tips: [
          'Use consistent, lowercase, hyphenated tags for best discoverability.',
          'The blog index lets you filter by one or more tags simultaneously.',
          'Common tags: aws, node-js, incident-review, cost-optimisation, security.',
        ],
        link: '/blog',
      },
    ],
  },
];

import { type ReactNode } from 'react';
import {
  Home, Server, Target, Rocket, ArrowUpCircle, GitBranch, AlertTriangle,
  Activity, BarChart3, DollarSign, Zap, Wrench, Workflow, Bell, Megaphone,
  ShieldCheck, ShieldAlert, Cpu, Database, Globe, BookOpen, FileText,
  Users, FlaskConical, GitPullRequest, RotateCcw, Clock, Lightbulb, Wallet,
  Network, Boxes, Briefcase, Flame,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
}

export interface NavDomain {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  color: string;
  isMock?: boolean;
  sections: {
    title: string;
    items: NavItem[];
  }[];
}

export const DOMAINS: NavDomain[] = [
  {
    id: 'observe',
    label: 'Observe',
    description: 'Monitor system health, logs, and telemetry.',
    icon: <EyeIcon className="h-6 w-6" />,
    color: 'from-blue-500 to-cyan-500',
    sections: [
      {
        title: 'Health',
        items: [
          { label: 'Dashboard', href: '/dashboard', icon: <Home className="h-4 w-4" /> },
          { label: 'Errors',    href: '/errors',    icon: <AlertTriangle className="h-4 w-4" /> },
        ],
      },
      {
        title: 'Inventory',
        items: [
          { label: 'Catalog',        href: '/catalog',              icon: <Server className="h-4 w-4" /> },
          { label: 'Tech Radar',     href: '/catalog/radar',        icon: <Target className="h-4 w-4" /> },
          { label: 'Service Graph',  href: '/catalog/service-graph', icon: <Boxes className="h-4 w-4" /> },
          { label: 'Drift Cache',    href: '/catalog/drift',        icon: <GitBranch className="h-4 w-4" /> },
          { label: 'Ownership Map',  href: '/catalog/ownership',    icon: <Users className="h-4 w-4" /> },
        ],
      },
      {
        title: 'Delivery',
        items: [
          { label: 'Deployments', href: '/deployments',           icon: <Rocket className="h-4 w-4" /> },
          { label: 'Promotion',   href: '/deployments/promotion', icon: <ArrowUpCircle className="h-4 w-4" /> },
          { label: 'Pipelines',   href: '/pipelines',             icon: <GitBranch className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'act',
    label: 'Act',
    description: 'Trigger workflows and remediation playbooks.',
    icon: <ZapIcon className="h-6 w-6" />,
    color: 'from-amber-500 to-orange-600',
    sections: [
      {
        title: 'Operations',
        items: [
          { label: 'Action Catalog',      href: '/portal',                 icon: <Wrench className="h-4 w-4" /> },
          { label: 'My Requests',         href: '/portal/requests',        icon: <FileText className="h-4 w-4" /> },
          { label: 'Database Allowlist',  href: '/portal/jit-resources',   icon: <Database className="h-4 w-4" /> },
          { label: 'Active Credentials',  href: '/portal/jit-sessions',    icon: <Clock className="h-4 w-4" /> },
          { label: 'Manage Operations',   href: '/portal/operations/manage', icon: <Wrench className="h-4 w-4" /> },
          { label: 'Runbook Studio',      href: '/portal/runbooks',        icon: <Workflow className="h-4 w-4" /> },
          { label: 'Env Config',          href: '/config/env',             icon: <Cpu className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'measure',
    label: 'Measure',
    description: 'Analyze delivery velocity and infrastructure costs.',
    icon: <ActivityIcon className="h-6 w-6" />,
    color: 'from-emerald-500 to-teal-600',
    sections: [
      {
        title: 'Engineering Flow',
        items: [
          { label: 'Sprint Digest',   href: '/measure/sprint',         icon: <FileText className="h-4 w-4" /> },
          { label: 'Health Signals',  href: '/measure/health-signals', icon: <Activity className="h-4 w-4" /> },
          { label: 'Velocity',        href: '/velocity',               icon: <BarChart3 className="h-4 w-4" /> },
          { label: 'Team Changelog',  href: '/changelog',              icon: <RotateCcw className="h-4 w-4" /> },
        ],
      },
      {
        title: 'Cost',
        items: [
          { label: 'Costs',      href: '/costs',              icon: <DollarSign className="h-4 w-4" /> },
          { label: 'Insights',   href: '/costs/insights',     icon: <Lightbulb className="h-4 w-4" /> },
          { label: 'Comparison', href: '/costs/comparison',   icon: <BarChart3 className="h-4 w-4" /> },
          { label: 'Budgets',      href: '/costs/budgets',      icon: <Wallet className="h-4 w-4" /> },
          { label: 'Attribution', href: '/costs/attribution',  icon: <BarChart3 className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Vulnerability scans, secrets audit, and GRC.',
    icon: <ShieldCheck className="h-6 w-6" />,
    color: 'from-indigo-600 to-violet-700',
    sections: [
      {
        title: 'Vulnerabilities',
        items: [
          { label: 'Feed',       href: '/security',          icon: <ShieldCheck className="h-4 w-4" /> },
          { label: 'Repositories', href: '/security/repos',  icon: <GitBranch className="h-4 w-4" /> },
          { label: 'GitLeaks',   href: '/security/gitleaks', icon: <AlertTriangle className="h-4 w-4" /> },
          { label: 'npm Audit',    href: '/security/npm-audit',    icon: <ShieldAlert className="h-4 w-4" /> },
          { label: 'Vuln Tracker', href: '/security/vuln-tracker', icon: <RotateCcw className="h-4 w-4" /> },
          { label: 'Dep Health',   href: '/deps/health',           icon: <Boxes className="h-4 w-4" /> },
          { label: 'Licenses',     href: '/security/licenses',     icon: <ShieldCheck className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'ai-studio',
    label: 'AI Studio',
    description: 'Agentic automation and LLM orchestration.',
    icon: <Cpu className="h-6 w-6" />,
    color: 'from-pink-500 to-rose-600',
    sections: [
      {
        title: 'Tools',
        items: [
          { label: 'PR Review',           href: '/ai/pr-review',       icon: <GitPullRequest className="h-4 w-4" /> },
          { label: 'Release Notes',       href: '/ai/release-notes',   icon: <FileText className="h-4 w-4" /> },
          { label: 'On-Call Briefing',    href: '/ai/oncall-briefing', icon: <Bell className="h-4 w-4" /> },
          { label: 'Dep Upgrade Advisor', href: '/ai/dep-advisor',     icon: <Zap className="h-4 w-4" /> },
          { label: 'Runbook Assistant',   href: '/ai/runbook',         icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Deployment Digest',   href: '/ai/digest',          icon: <Rocket className="h-4 w-4" /> },
          { label: 'CVE Triage',          href: '/ai/cve-triage',      icon: <ShieldAlert className="h-4 w-4" /> },
          { label: 'Incident Scribe',     href: '/ai/incident',        icon: <FileText className="h-4 w-4" /> },
        ],
      },
      {
        title: 'Labs',
        items: [
          { label: 'Campaign Impact',     href: '/ai/campaign-impact', icon: <Users className="h-4 w-4" /> },
          { label: 'Infra Simulator',     href: '/ai/infra-simulate',  icon: <FlaskConical className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infra',
    description: 'Cloud resource inventory and VPC topology.',
    icon: <Database className="h-6 w-6" />,
    color: 'from-cyan-600 to-blue-700',
    sections: [
      { title: 'Visibility', items: [
        { label: 'Resource Inventory', href: '/infra/resources', icon: <Server className="h-4 w-4" /> },
      ]},
    ],
  },
  {
    id: 'connectivity',
    label: 'Global',
    description: 'DNS, CDN, certificates, and edge network management.',
    icon: <Globe className="h-6 w-6" />,
    color: 'from-sky-400 to-blue-500',
    sections: [
      { title: 'Edge & Security', items: [
        { label: 'CloudFront',   href: '/global/distributions', icon: <Globe className="h-4 w-4" /> },
        { label: 'Route 53 DNS', href: '/global/dns',           icon: <Globe className="h-4 w-4" /> },
        { label: 'Certificates', href: '/global/certificates',  icon: <Globe className="h-4 w-4" /> },
      ]},
    ],
  },
  {
    id: 'on-call',
    label: 'On Call',
    description: 'Incident management and on-call schedules.',
    icon: <AlertIcon className="h-6 w-6" />,
    color: 'from-red-500 to-rose-600',
    sections: [
      {
        title: 'Response',
        items: [
          { label: 'Incidents',    href: '/on-call/incidents', icon: <Flame className="h-4 w-4" /> },
          { label: 'Schedule',     href: '/on-call/schedule',  icon: <Clock className="h-4 w-4" /> },
          { label: 'Postmortems',  href: '/postmortems',       icon: <FileText className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'notify',
    label: 'Notify',
    description: 'Team communications and reliability broadcasts.',
    icon: <BellIcon className="h-6 w-6" />,
    color: 'from-yellow-400 to-amber-500',
    sections: [
      {
        title: 'Comm',
        items: [
          { label: 'Announcements',       href: '/announcements',           icon: <Megaphone className="h-4 w-4" /> },
          { label: 'Broadcast Templates', href: '/notify/broadcasts',       icon: <Bell className="h-4 w-4" /> },
          { label: 'Weekly Digest',       href: '/notify/weekly-digest',    icon: <FileText className="h-4 w-4" /> },
        ],
      },
      {
        title: 'Automation',
        items: [
          { label: 'Alert Rules',         href: '/notify/alert-rules',      icon: <Zap className="h-4 w-4" /> },
          { label: 'Subscriptions',       href: '/notify/subscriptions',    icon: <Activity className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'brain',
    label: 'Brain',
    description: 'Live MCP intelligence over code, infra, data, and observability.',
    icon: <Cpu className="h-6 w-6" />,
    color: 'from-fuchsia-500 to-purple-600',
    sections: [
      {
        title: 'Washmen MCP',
        items: [
          { label: 'MCP Explorer', href: '/mcp', icon: <Cpu className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'docs',
    label: 'Docs',
    description: 'Platform documentation, feature guides, and onboarding.',
    icon: <BookOpen className="h-6 w-6" />,
    color: 'from-violet-500 to-purple-600',
    sections: [
      {
        title: 'Guides',
        items: [
          { label: 'Overview',        href: '/docs',                        icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Getting Started', href: '/docs/getting-started',        icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Platform Setup',  href: '/docs/platform-setup',         icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Observe',         href: '/docs/observe',                icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Act',             href: '/docs/act',                    icon: <BookOpen className="h-4 w-4" /> },
          { label: 'Security',        href: '/docs/security',               icon: <BookOpen className="h-4 w-4" /> },
        ],
      },
    ],
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'Engineering knowledge sharing and team learnings.',
    icon: <PenIcon className="h-6 w-6" />,
    color: 'from-teal-500 to-emerald-600',
    sections: [
      {
        title: 'Content',
        items: [
          { label: 'All Posts', href: '/blog', icon: <BookOpen className="h-4 w-4" /> },
        ],
      },
    ],
  },
];

// Internal helpers to evade export conflicts if needed
function EyeIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg></span>; }
function ZapIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.71 12 3v9h8L12 21v-9H4Z"/></svg></span>; }
function ActivityIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>; }
function BellIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>; }
function AlertIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>; }
function PenIcon(props: any) { return <span {...props}><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span>; }

import type { KnownBlock } from '@slack/web-api';

export interface DeploymentNotificationData {
  serviceName: string;
  environment: string;
  sha: string;
  actor: string;
  status: 'success' | 'failure' | 'started' | 'rolled-back';
  repositoryUrl: string;
  durationSeconds?: number;
}

export function deploymentNotification(data: DeploymentNotificationData): KnownBlock[] {
  const statusEmoji: Record<string, string> = {
    success: ':white_check_mark:',
    failure: ':x:',
    started: ':hourglass_flowing_sand:',
    'rolled-back': ':rewind:',
  };

  const emoji = statusEmoji[data.status] ?? ':question:';
  const shortSha = data.sha.slice(0, 7);
  const duration = data.durationSeconds
    ? ` in ${Math.round(data.durationSeconds)}s`
    : '';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${data.serviceName}* deployed to *${data.environment}*${duration}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `SHA: <${data.repositoryUrl}/commit/${data.sha}|${shortSha}> | Actor: ${data.actor} | Status: ${data.status}`,
        },
      ],
    },
  ];
}

export interface WeeklyDigestData {
  period: string;
  orgMetrics: {
    deploymentFrequency: number;
    leadTimeForChanges: number;
    meanTimeToRecovery: number | null;
    changeFailureRate: number;
  };
  improvements: string[];
  degradations: string[];
  unacknowledgedAnomalies: number;
}

export function weeklyDigest(data: WeeklyDigestData): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Engineering Velocity — Week of ${data.period}` },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Deploy Frequency*\n${data.orgMetrics.deploymentFrequency.toFixed(2)}/day`,
        },
        {
          type: 'mrkdwn',
          text: `*Lead Time*\n${data.orgMetrics.leadTimeForChanges.toFixed(1)}h`,
        },
        {
          type: 'mrkdwn',
          text: `*MTTR*\n${data.orgMetrics.meanTimeToRecovery !== null ? `${data.orgMetrics.meanTimeToRecovery.toFixed(1)}h` : 'No incidents'}`,
        },
        {
          type: 'mrkdwn',
          text: `*Change Failure Rate*\n${data.orgMetrics.changeFailureRate.toFixed(1)}%`,
        },
      ],
    },
  ];

  if (data.improvements.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:chart_with_upwards_trend: *Improvements*\n${data.improvements.map((i) => `• ${i}`).join('\n')}`,
      },
    });
  }

  if (data.degradations.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:chart_with_downwards_trend: *Areas to Watch*\n${data.degradations.map((d) => `• ${d}`).join('\n')}`,
      },
    });
  }

  return blocks;
}

export interface AnomalyAlertData {
  teamName: string;
  metricName: string;
  currentValue: number;
  rollingAverage: number;
  direction: 'improved' | 'degraded';
}

export function anomalyAlert(data: AnomalyAlertData): KnownBlock[] {
  const emoji = data.direction === 'improved' ? ':tada:' : ':eyes:';
  const verb = data.direction === 'improved' ? 'improved' : 'changed';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${data.teamName}* — ${data.metricName} has ${verb} significantly`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Current: ${data.currentValue.toFixed(2)} | 8-week avg: ${data.rollingAverage.toFixed(2)}`,
        },
      ],
    },
  ];
}

export interface DriftWarningData {
  serviceName: string;
  commitsBehind: number;
  daysBehind: number;
  compareUrl: string;
}

export function driftWarning(data: DriftWarningData): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *${data.serviceName}* production is ${data.commitsBehind} commits behind staging (${data.daysBehind} days)`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Diff' },
          url: data.compareUrl,
        },
      ],
    },
  ];
}

export interface PortalRequestNotificationData {
  requestId: string;
  operationName: string;
  requesterName: string;
  requesterMention: string | null;
  tier: string;
  parameters: Record<string, string>;
  submittedAt: string;
  portalUrl: string;
}

export function portalRequestNotification(data: PortalRequestNotificationData): KnownBlock[] {
  const tierEmoji: Record<string, string> = {
    'self-serve': ':white_check_mark:',
    'peer-approved': ':eyes:',
    'devops-approved': ':shield:',
  };
  const emoji = tierEmoji[data.tier] ?? ':bell:';
  // requesterMention is already resolved to "<@UXXXXXXX>" or "@username" by the caller
  const requester = data.requesterMention ?? data.requesterName;
  const paramLines = Object.entries(data.parameters)
    .map(([k, v]) => `• *${k}:* ${v}`)
    .join('\n');

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} New Portal Request: ${data.operationName}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Requested by:*\n${requester}` },
        { type: 'mrkdwn', text: `*Approval tier:*\n${data.tier}` },
        { type: 'mrkdwn', text: `*Submitted at:*\n${new Date(data.submittedAt).toLocaleString()}` },
        { type: 'mrkdwn', text: `*Request ID:*\n\`${data.requestId}\`` },
      ],
    },
  ];

  if (paramLines) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Parameters:*\n${paramLines}` },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View Request' },
        url: `${data.portalUrl}/${data.requestId}`,
        style: 'primary',
      },
    ],
  });

  return blocks;
}

export interface JitCredentialDMData {
  resourceName: string;
  environment: string;
  host: string;
  port: number;
  dbName: string;
  username: string;
  password: string;
  accessLevel: 'readonly' | 'readwrite';
  expiresAt: string;   // ISO8601
  portalSessionUrl: string;
}

export function jitCredentialDM(data: JitCredentialDMData): KnownBlock[] {
  const expiresDate = new Date(data.expiresAt);
  const expiresFormatted = expiresDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const connectionString = `postgresql://${data.username}:${data.password}@${data.host}:${data.port}/${data.dbName}`;
  const psqlCmd = `psql "${connectionString}"`;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':key: JIT Database Access Granted' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Database:*\n${data.resourceName}` },
        { type: 'mrkdwn', text: `*Environment:*\n${data.environment}` },
        { type: 'mrkdwn', text: `*Access level:*\n${data.accessLevel === 'readwrite' ? 'Read + Write' : 'Read only'}` },
        { type: 'mrkdwn', text: `*Expires:*\n${expiresFormatted}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Connection details:*\n\`\`\`Host:     ${data.host}\nPort:     ${data.port}\nDatabase: ${data.dbName}\nUsername: ${data.username}\nPassword: ${data.password}\`\`\``,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quick connect:*\n\`\`\`${psqlCmd}\`\`\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: ':warning: These credentials expire automatically. Do not share them. Session is logged for audit.',
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Session' },
          url: data.portalSessionUrl,
        },
      ],
    },
  ];
}

export interface AwsActionCredentialDMData {
  operationName: string;
  parameters: Record<string, string>;
  roleArn: string;
  assumeCommand: string;
  roleSessionName: string;
  expiresAt: string;
  consoleUrl?: string;
  approvalMode: 'manual' | 'auto';
  autoApprovalRule?: string;
  portalRequestUrl: string;
}

export function awsActionCredentialDM(data: AwsActionCredentialDMData): KnownBlock[] {
  const expiresFormatted = new Date(data.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const paramSummary = Object.entries(data.parameters)
    .filter(([k]) => k !== 'justification')
    .map(([k, v]) => `${k}=${v}`).join(' · ');

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: data.approvalMode === 'auto' ? ':white_check_mark: Auto-approved · AWS access ready' : ':key: AWS access granted' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Operation:*\n${data.operationName}` },
        { type: 'mrkdwn', text: `*Role expires:*\n${expiresFormatted}` },
        { type: 'mrkdwn', text: `*Session name (CloudTrail):*\n\`${data.roleSessionName}\`` },
        { type: 'mrkdwn', text: `*Approval:*\n${data.approvalMode === 'auto' ? `auto · ${data.autoApprovalRule ?? ''}` : 'manual'}` },
      ],
    },
  ];

  if (paramSummary) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*Parameters:* ${paramSummary}` }],
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Role ARN:*\n\`${data.roleArn}\``,
    },
  });

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Assume role command* (paste into your terminal):\n\`\`\`${data.assumeCommand}\`\`\``,
    },
  });

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: ':warning: This role is scoped to your IAM identity only. It will be automatically deleted when it expires. Every API call is recorded in CloudTrail under your session name.' }],
  });

  const buttons: KnownBlock = {
    type: 'actions',
    elements: [
      { type: 'button', text: { type: 'plain_text', text: 'View Request' }, url: data.portalRequestUrl },
      ...(data.consoleUrl ? [{ type: 'button' as const, text: { type: 'plain_text' as const, text: 'Open AWS Console' }, url: data.consoleUrl, style: 'primary' as const }] : []),
    ],
  };
  blocks.push(buttons);
  return blocks;
}

export interface DbCredentialsDMData {
  operationName: string;
  engine: 'postgres' | 'redshift';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  expiresAt: string;
  approvalMode: 'manual' | 'auto';
  autoApprovalRule?: string;
  portalRequestUrl: string;
}

export function dbCredentialsDM(data: DbCredentialsDMData): KnownBlock[] {
  const expiresFormatted = new Date(data.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const psqlCmd = `psql "postgresql://${data.username}:${data.password}@${data.host}:${data.port}/${data.database}?sslmode=require"`;
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: data.approvalMode === 'auto' ? ':white_check_mark: Auto-approved · DB access' : ':key: DB access granted' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Operation:*\n${data.operationName}` },
        { type: 'mrkdwn', text: `*Engine:*\n${data.engine}` },
        { type: 'mrkdwn', text: `*Database:*\n${data.database}` },
        { type: 'mrkdwn', text: `*Expires:*\n${expiresFormatted}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Connection details:*\n\`\`\`Host:     ${data.host}\nPort:     ${data.port}\nDatabase: ${data.database}\nUsername: ${data.username}\nPassword: ${data.password}\`\`\``,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Quick connect:*\n\`\`\`${psqlCmd}\`\`\`` },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: ':warning: These credentials expire automatically. Do not share them. Session is logged for audit.' }],
    },
    {
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Request' }, url: data.portalRequestUrl }],
    },
  ];
}

export interface JitRevocationDMData {
  resourceName: string;
  username: string;
  revokedBy: 'scheduler' | string;
  sessionUrl: string;
}

export function jitRevocationDM(data: JitRevocationDMData): KnownBlock[] {
  const reason = data.revokedBy === 'scheduler' ? 'Session expired automatically.' : `Manually revoked by ${data.revokedBy}.`;
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:lock: *JIT access to ${data.resourceName} has been revoked.*\nUser \`${data.username}\` has been dropped and all connections terminated.\n${reason}`,
      },
    },
    {
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Session' }, url: data.sessionUrl }],
    },
  ];
}

// ---------------------------------------------------------------------------
// AWS resource access grant (thread reply in the request channel)
// ---------------------------------------------------------------------------

export interface AwsAccessGrantedData {
  requesterMention: string | null;
  requesterName: string;
  resourceArn: string;
  awsService: string;
  awsAction: string;
  roleSessionName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
  expiresAt: string;   // ISO8601
  consoleUrl: string;
  portalSessionUrl: string;
}

export function awsAccessGranted(data: AwsAccessGrantedData): KnownBlock[] {
  const expires = new Date(data.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const requester = data.requesterMention ?? data.requesterName;
  const resourceName = data.resourceArn.split(/[:/]/).pop() ?? data.resourceArn;

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':rocket: Temporary AWS Access Granted' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Granted to:*\n${requester}` },
        { type: 'mrkdwn', text: `*Resource:*\n\`${resourceName}\`` },
        { type: 'mrkdwn', text: `*Action:*\n\`${data.awsAction}\`` },
        { type: 'mrkdwn', text: `*Expires:*\n${expires}` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*AWS CLI credentials:*\n\`\`\`[wep-jit]\naws_access_key_id     = ${data.accessKeyId}\naws_secret_access_key = ${data.secretAccessKey}\naws_session_token     = ${data.sessionToken}\nregion                = ${data.region}\`\`\``,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Export for shell:*\n\`\`\`export AWS_ACCESS_KEY_ID=${data.accessKeyId}\nexport AWS_SECRET_ACCESS_KEY=${data.secretAccessKey}\nexport AWS_SESSION_TOKEN=${data.sessionToken}\nexport AWS_DEFAULT_REGION=${data.region}\`\`\``,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:warning: Session \`${data.roleSessionName}\` is scoped to \`${data.awsAction}\` on \`${data.resourceArn}\` only. All actions are logged in CloudTrail under this session name. Do not share these credentials.`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in AWS Console' },
          url: data.consoleUrl,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Session' },
          url: data.portalSessionUrl,
        },
      ],
    },
  ];
}

export interface PortalApprovalNotificationData {
  requestId: string;
  operationName: string;
  requesterMention: string | null;
  requesterName: string;
  approvedBy: string;
  approved: boolean;
  reason?: string;
  portalUrl: string;
}

export function portalApprovalNotification(data: PortalApprovalNotificationData): KnownBlock[] {
  const emoji = data.approved ? ':white_check_mark:' : ':x:';
  const status = data.approved ? 'approved' : 'rejected';
  // requesterMention is already resolved to "<@UXXXXXXX>" or "@username" by the caller
  const requester = data.requesterMention ?? data.requesterName;

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} ${requester} — your request for *${data.operationName}* has been *${status}* by ${data.approvedBy}.`,
      },
    },
  ];

  if (!data.approved && data.reason) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Reason:* ${data.reason}` },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'View Request' },
        url: `${data.portalUrl}/${data.requestId}`,
      },
    ],
  });

  return blocks;
}

import { WebClient } from '@slack/web-api';

export interface AlertRule {
  id: string;
  name: string;
  condition: 'deploy_failed' | 'p1_incident' | 'cost_spike' | 'critical_vuln' | 'config_drift' | 'weekly_digest' | 'oncall_shift';
  threshold?: number;
  channelType: 'slack' | 'email';
  channelTarget: string;
  enabled: boolean;
}

let slackClient: WebClient | null = null;

function getSlackClient(): WebClient {
  if (!slackClient) {
    const token = process.env['SLACK_BOT_TOKEN'];
    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable is not set');
    }
    slackClient = new WebClient(token);
  }
  return slackClient;
}

export async function sendSlackAlert(
  channel: string,
  rule: AlertRule,
  finding: string,
): Promise<void> {
  const client = getSlackClient();
  const timestamp = new Date().toISOString();

  await client.chat.postMessage({
    channel,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `⚠️ WEP Alert: ${rule.name}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: finding,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${timestamp}  |  Condition: \`${rule.condition}\``,
          },
        ],
      },
    ],
    text: `⚠️ WEP Alert: ${rule.name} — ${finding}`,
  });
}

import { WebClient } from '@slack/web-api';
import { getSecret } from '@wep/aws-clients';
import { type Result, success, failure, type DomainError, domainError } from '@wep/domain-types';
import type { KnownBlock } from '@slack/web-api';

let slackClient: WebClient | null = null;
// username → Slack user ID cache (avoids repeated users.list calls)
const userIdCache = new Map<string, string>();

async function getClient(secretId: string): Promise<Result<WebClient, DomainError>> {
  if (slackClient) return success(slackClient);

  // Prefer SLACK_BOT_TOKEN env var (dev/local). Fall back to Secrets Manager (prod).
  const envToken = process.env['SLACK_BOT_TOKEN'];
  if (envToken) {
    slackClient = new WebClient(envToken);
    return success(slackClient);
  }

  const tokenResult = await getSecret(secretId);
  if (!tokenResult.ok) return tokenResult;

  slackClient = new WebClient(tokenResult.value);
  return success(slackClient);
}

// Resolve a Slack username (as entered by the user) to a Slack user ID for proper tagging.
// Checks display_name and name fields. Returns null if not found.
async function resolveUserId(client: WebClient, username: string): Promise<string | null> {
  const lower = username.toLowerCase().replace(/^@/, '');

  if (userIdCache.has(lower)) return userIdCache.get(lower)!;

  try {
    let cursor: string | undefined;
    do {
      const res = await client.users.list({ limit: 200, cursor });
      for (const member of res.members ?? []) {
        if (member.deleted || member.is_bot) continue;
        const displayName         = (member.profile?.display_name ?? '').toLowerCase();
        const displayNameNorm     = (member.profile?.display_name_normalized ?? '').toLowerCase();
        const realName            = (member.profile?.real_name ?? '').toLowerCase();
        const realNameNorm        = (member.profile?.real_name_normalized ?? '').toLowerCase();
        const name                = (member.name ?? '').toLowerCase();
        if (displayName === lower || displayNameNorm === lower || realName === lower || realNameNorm === lower || name === lower) {
          if (member.id) {
            userIdCache.set(lower, member.id);
            return member.id;
          }
        }
      }
      cursor = (res.response_metadata?.next_cursor as string | undefined) || undefined;
    } while (cursor);
  } catch {
    console.warn('[slack] users.list lookup failed for username:', username);
  }
  return null;
}

export class SlackNotifier {
  constructor(private readonly secretId: string = 'wep/slack-bot-token') {}

  // Resolves a raw username to "<@UXXXXXXX>" for proper Slack tagging.
  // Falls back to "@username" text if the user can't be found.
  async resolveMention(username: string): Promise<string> {
    const clientResult = await getClient(this.secretId);
    if (!clientResult.ok) return `@${username}`;
    const userId = await resolveUserId(clientResult.value, username);
    return userId ? `<@${userId}>` : `@${username}`;
  }

  // Resolves a work email to a Slack user ID via users.lookupByEmail.
  // Returns null if the email is not found or the API call fails.
  // Requires the users:read.email OAuth scope.
  async resolveUserIdByEmail(email: string): Promise<string | null> {
    const clientResult = await getClient(this.secretId);
    if (!clientResult.ok) return null;
    try {
      const res = await clientResult.value.users.lookupByEmail({ email });
      return res.user?.id ?? null;
    } catch {
      console.warn('[slack] users.lookupByEmail failed for email:', email);
      return null;
    }
  }

  // Resolves an email to a "<@UXXXXXXX>" mention. Falls back to the email itself.
  async resolveMentionByEmail(email: string): Promise<string> {
    const userId = await this.resolveUserIdByEmail(email);
    return userId ? `<@${userId}>` : email;
  }

  async sendToChannel(
    channelId: string,
    blocks: KnownBlock[],
    text?: string,
    threadTs?: string,
  ): Promise<Result<string | null, DomainError>> {
    const clientResult = await getClient(this.secretId);
    if (!clientResult.ok) return clientResult;

    try {
      const result = await clientResult.value.chat.postMessage({
        channel: channelId,
        blocks,
        text: text ?? 'WEP Notification',
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return success(result.ts ?? null);
    } catch (error) {
      return failure(domainError('SLACK_SEND_FAILED', 'Failed to send Slack message', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async sendDM(
    userId: string,
    blocks: KnownBlock[],
    text?: string,
  ): Promise<Result<void, DomainError>> {
    const clientResult = await getClient(this.secretId);
    if (!clientResult.ok) return clientResult;

    try {
      const conversation = await clientResult.value.conversations.open({ users: userId });
      const channelId = conversation.channel?.id;
      if (!channelId) {
        return failure(domainError('SLACK_DM_FAILED', `Could not open DM with user ${userId}`));
      }

      await clientResult.value.chat.postMessage({
        channel: channelId,
        blocks,
        text: text ?? 'WEP Notification',
      });
      return success(undefined);
    } catch (error) {
      return failure(domainError('SLACK_SEND_FAILED', 'Failed to send Slack DM', {
        cause: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { setGitHubTokenOverride } from '@wep/github-client';
import {
  SSOOIDCClient,
  CreateTokenCommand,
} from '@aws-sdk/client-sso-oidc';
import {
  SSOClient,
  ListAccountRolesCommand,
  GetRoleCredentialsCommand,
} from '@aws-sdk/client-sso';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const WEB_BASE = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
const AWS_REGION = process.env['AWS_REGION'] ?? 'eu-west-1';
const SSO_START_URL = process.env['AWS_SSO_START_URL'] ?? '';
const SSO_REGION = process.env['AWS_SSO_REGION'] ?? AWS_REGION;
const DEVOPS_ROLE_PATTERN = process.env['DEVOPS_ROLE_PATTERN'] ?? 'DevOpsDomainOwner';
const EMAIL_DOMAIN = process.env['WEP_EMAIL_DOMAIN'] ?? 'washmen.com';

// ── GitHub ────────────────────────────────────────────────────────────────────

const GH_CLIENT_ID = process.env['GITHUB_CLIENT_ID'] ?? '';
const GH_CLIENT_SECRET = process.env['GITHUB_CLIENT_SECRET'] ?? '';
const GH_CALLBACK = `${API_BASE}/api/v1/oauth/github/callback`;

// ── AWS SSO OIDC ──────────────────────────────────────────────────────────────
// The client_id/client_secret come from registering with IAM Identity Center.
// Run: aws sso-oidc register-client --client-name wep --client-type public --region <sso-region>
// and store the result as AWS_SSO_CLIENT_ID + AWS_SSO_CLIENT_SECRET in .env.

const SSO_CLIENT_ID = process.env['AWS_SSO_CLIENT_ID'] ?? '';
const SSO_CLIENT_SECRET = process.env['AWS_SSO_CLIENT_SECRET'] ?? '';
const SSO_CALLBACK = `${API_BASE}/api/v1/oauth/aws/callback`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomState(): string {
  return randomBytes(16).toString('hex');
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createOAuthRouter(): Router {
  const router = Router();

  // ── GitHub ────────────────────────────────────────────────────────────────

  router.get('/github', (req: Request, res: Response) => {
    if (!GH_CLIENT_ID) {
      res.status(503).json({ error: 'GitHub OAuth not configured' });
      return;
    }
    const state = randomState();
    req.session.githubOAuth = { state };

    const params = new URLSearchParams({
      client_id: GH_CLIENT_ID,
      redirect_uri: GH_CALLBACK,
      scope: 'read:org read:user',
      state,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  router.get('/github/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query as Record<string, string>;
    if (!state || state !== req.session.githubOAuth?.state) {
      res.redirect(`${WEB_BASE}/settings?auth=error&provider=github&reason=state_mismatch`);
      return;
    }
    delete req.session.githubOAuth;

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code, redirect_uri: GH_CALLBACK }),
      });
      const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) throw new Error(tokenData.error ?? 'no_token');

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'WEP' },
      });
      const userData = await userRes.json() as { login?: string };

      req.session.github = { token: tokenData.access_token, login: userData.login ?? 'unknown' };
      setGitHubTokenOverride(tokenData.access_token);
      await new Promise<void>((resolve, reject) => req.session.save((e) => e ? reject(e) : resolve()));
      res.redirect(`${WEB_BASE}/settings?auth=success&provider=github`);
    } catch (e) {
      console.error('[oauth/github] callback error:', e);
      res.redirect(`${WEB_BASE}/settings?auth=error&provider=github&reason=callback_failed`);
    }
  });

  // ── AWS SSO OIDC ──────────────────────────────────────────────────────────

  router.get('/aws', (req: Request, res: Response) => {
    if (!SSO_CLIENT_ID || !SSO_START_URL) {
      res.status(503).json({ error: 'AWS SSO OAuth not configured' });
      return;
    }
    const state = randomState();
    const { verifier, challenge } = pkce();
    req.session.awsOAuth = { state, codeVerifier: verifier };

    const authorizeUrl = SSO_START_URL.replace(/\/$/, '') + '/oauth2/authorize';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: SSO_CLIENT_ID,
      redirect_uri: SSO_CALLBACK,
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    res.redirect(`${authorizeUrl}?${params}`);
  });

  router.get('/aws/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query as Record<string, string>;
    if (!state || state !== req.session.awsOAuth?.state) {
      res.redirect(`${WEB_BASE}/settings?auth=error&provider=aws&reason=state_mismatch`);
      return;
    }
    const codeVerifier = req.session.awsOAuth.codeVerifier;
    delete req.session.awsOAuth;

    try {
      const oidcClient = new SSOOIDCClient({ region: SSO_REGION });
      const tokenResp = await oidcClient.send(new CreateTokenCommand({
        clientId: SSO_CLIENT_ID,
        clientSecret: SSO_CLIENT_SECRET,
        grantType: 'authorization_code',
        redirectUri: SSO_CALLBACK,
        code,
        codeVerifier,
      }));

      const accessToken = tokenResp.accessToken;
      if (!accessToken) throw new Error('no_access_token');

      // Auto-discover the first available role (no picker)
      const ssoClient = new SSOClient({ region: SSO_REGION });
      const accountId = process.env['AWS_ACCOUNT_ID'] ?? '';

      const rolesResp = await ssoClient.send(new ListAccountRolesCommand({
        accessToken,
        accountId,
      }));

      const roles = rolesResp.roleList ?? [];
      if (roles.length === 0) throw new Error('no_roles_available');

      // Prefer DevOps role if present, else take first
      const role = roles.find((r) => r.roleName?.includes(DEVOPS_ROLE_PATTERN)) ?? roles[0]!;

      const credsResp = await ssoClient.send(new GetRoleCredentialsCommand({
        accessToken,
        accountId,
        roleName: role.roleName!,
      }));

      const rc = credsResp.roleCredentials;
      if (!rc?.accessKeyId || !rc.secretAccessKey || !rc.sessionToken) throw new Error('incomplete_credentials');

      // Verify identity and derive username
      const sts = new STSClient({
        region: AWS_REGION,
        credentials: {
          accessKeyId: rc.accessKeyId,
          secretAccessKey: rc.secretAccessKey,
          sessionToken: rc.sessionToken,
        },
      });
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      const arn = identity.Arn ?? '';
      const roleMatch = /assumed-role\/([^/]+)\/(.+)$/.exec(arn);
      const username = roleMatch?.[2] ?? arn.split(':').pop() ?? 'unknown';
      const email = username.includes('@') ? username : `${username}@${EMAIL_DOMAIN}`;

      const expiresAt = rc.expiration
        ? new Date(rc.expiration * 1000).toISOString()
        : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

      req.session.aws = {
        accessKeyId: rc.accessKeyId,
        secretAccessKey: rc.secretAccessKey,
        sessionToken: rc.sessionToken,
        expiresAt,
        username,
        email,
        accountId,
      };

      await new Promise<void>((resolve, reject) => req.session.save((e) => e ? reject(e) : resolve()));
      res.redirect(`${WEB_BASE}/settings?auth=success&provider=aws`);
    } catch (e) {
      console.error('[oauth/aws] callback error:', e);
      res.redirect(`${WEB_BASE}/settings?auth=error&provider=aws&reason=callback_failed`);
    }
  });

  // ── Session status ────────────────────────────────────────────────────────

  router.get('/status', (req: Request, res: Response) => {
    const aws = req.session.aws;
    const github = req.session.github;

    const awsExpired = aws ? new Date(aws.expiresAt) <= new Date() : false;

    res.json({
      aws: aws && !awsExpired
        ? { connected: true, username: aws.username, email: aws.email, expiresAt: aws.expiresAt }
        : { connected: false },
      github: github
        ? { connected: true, login: github.login }
        : { connected: false },
    });
  });

  // ── Logout ────────────────────────────────────────────────────────────────

  router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy((e) => {
      if (e) console.error('[oauth] logout error:', e);
      res.clearCookie('wep_session');
      res.json({ ok: true });
    });
  });

  router.delete('/aws', (req: Request, res: Response) => {
    delete req.session.aws;
    res.json({ ok: true });
  });

  router.delete('/github', (req: Request, res: Response) => {
    delete req.session.github;
    res.json({ ok: true });
  });

  return router;
}

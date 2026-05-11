import session from 'express-session';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';

declare module 'express-session' {
  interface SessionData {
    aws?: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiresAt: string;  // ISO string
      username: string;
      email: string;
      accountId: string;
    };
    github?: {
      token: string;
      login: string;
    };
    /** PKCE/state values stored during the OAuth dance */
    awsOAuth?: {
      state: string;
      codeVerifier: string;
    };
    githubOAuth?: {
      state: string;
    };
  }
}

export function createSessionMiddleware(): import('express').RequestHandler {
  const secret = process.env['SESSION_SECRET'];
  if (!secret) throw new Error('SESSION_SECRET env var is required');

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('REDIS_URL env var is required');

  const redisClient = createClient({ url: redisUrl });
  redisClient.connect().catch((err: unknown) => console.error('[session] Redis connect error:', err));
  redisClient.on('error', (err: unknown) => console.error('[session] Redis error:', err));

  const store = new RedisStore({ client: redisClient as any, prefix: 'wep:sess:' });

  return session({
    store,
    secret,
    name: 'wep_session',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  });
}

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { config } from './config';

const router = Router();

// Login page
router.get('/auth/login', (req: Request, res: Response) => {
  if ((req.session as any)?.user) {
    res.redirect('/');
    return;
  }
  const error = req.query.error as string | undefined;
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>MCliPpy — Login</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #e0e0e0;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .login-box { text-align: center; padding: 3rem; border-radius: 12px; background: #1a1a1a; border: 1px solid #333; }
  h1 { font-size: 2rem; margin-bottom: 0.5rem; }
  h1 span { color: #5eb3ff; }
  p { color: #888; margin-bottom: 2rem; }
  .error { color: #ff4444; margin-bottom: 1rem; }
  a.btn { display: inline-block; padding: 12px 24px; background: #e0e0e0; color: #111; text-decoration: none;
    border-radius: 6px; font-weight: 600; transition: background 0.2s; }
  a.btn:hover { background: #ccc; }
</style></head><body>
<div class="login-box">
  <h1>M<span>Cli</span>Ppy</h1>
  <p>Shared clipboard for humans and machines</p>
  ${error === 'not_allowed' ? '<div class="error">Access denied — your email is not allowed.</div>' : ''}
  <a class="btn" href="/auth/google">Sign in with Google</a>
</div></body></html>`);
});

// Start Google OAuth
router.get('/auth/google', (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString('hex');
  (req.session as any).oauthState = state;

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// OAuth callback
router.get('/auth/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== (req.session as any).oauthState) {
      res.redirect('/auth/login');
      return;
    }
    delete (req.session as any).oauthState;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      res.redirect('/auth/login');
      return;
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json();

    if (user.email !== config.allowedEmail) {
      res.redirect('/auth/login?error=not_allowed');
      return;
    }

    (req.session as any).user = {
      email: user.email,
      name: user.name,
      picture: user.picture,
    };

    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/auth/login');
  }
});

// Logout
router.post('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

export default router;

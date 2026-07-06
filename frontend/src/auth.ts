import { setAdminToken } from './api';
import type { AuthConfig } from './types';

const verifierKey = 'rcjv.pkce.verifier';
const returnToKey = 'rcjv.pkce.return_to';

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function beginLogin(config: AuthConfig, returnTo = `${window.location.pathname}${window.location.search}`) {
  if (!config.issuer || !config.client_id) throw new Error('FusionAuth is not configured');
  const verifier = randomString(48);
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(returnToKey, returnTo.startsWith('/') ? returnTo : '/');
  const challenge = base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const redirectUri = `${window.location.origin}/admin/callback`;
  const url = new URL(`${config.issuer}/oauth2/authorize`);
  url.searchParams.set('client_id', config.client_id);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email offline_access');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(url.toString());
}

export async function completeLogin(config: AuthConfig) {
  const code = new URLSearchParams(window.location.search).get('code');
  const verifier = sessionStorage.getItem(verifierKey);
  if (!code || !verifier) throw new Error('Missing OAuth callback state');

  const response = await fetch(`${config.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.client_id,
      redirect_uri: `${window.location.origin}/admin/callback`,
      code,
      code_verifier: verifier
    })
  });
  if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
  const token = (await response.json()) as { access_token?: string; id_token?: string };
  setAdminToken(token.access_token || token.id_token || '');
  sessionStorage.removeItem(verifierKey);
  const returnTo = sessionStorage.getItem(returnToKey) || '/admin';
  sessionStorage.removeItem(returnToKey);
  window.location.replace(returnTo);
}

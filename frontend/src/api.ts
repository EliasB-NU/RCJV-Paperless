import type { AuthConfig, Field, LeagueSettings, Match, MatchPrecheck, MatchRuntimeState } from './types';

const tokenKey = 'rcjv.admin.token';

export function getAdminToken(): string {
  return localStorage.getItem(tokenKey) ?? '';
}

export function setAdminToken(token: string) {
  if (token.trim()) localStorage.setItem(tokenKey, token.trim());
  else localStorage.removeItem(tokenKey);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const parsed = await response.json();
      message = parsed.message || parsed.error || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  authConfig: () => request<AuthConfig>('/api/auth/config'),
  fields: () => request<Field[]>('/api/fields'),
  tabletMatches: (field: string) => request<Match[]>(`/api/tablet/matches?field=${encodeURIComponent(field)}`),
  match: (id: number) => request<Match>(`/api/matches/${id}`),
  savePrecheck: (id: number, precheck: MatchPrecheck) =>
    request<Match>(`/api/matches/${id}/precheck`, {
      method: 'POST',
      body: JSON.stringify({ precheck })
    }),
  recordEvent: (id: number, event: unknown) =>
    request<Match>(`/api/matches/${id}/events`, {
      method: 'POST',
      body: JSON.stringify({ event })
    }),
  saveMatchState: (id: number, state: MatchRuntimeState) =>
    request<Match>(`/api/matches/${id}/state`, {
      method: 'POST',
      body: JSON.stringify({
        state,
        final_goals1: state.score1,
        final_goals2: state.score2,
        comments: state.comments
      })
    }),
  finishMatch: (id: number, body: unknown) =>
    request<Match>(`/api/matches/${id}/finish`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  createDocuSeal: (id: number) =>
    request<Match>(`/api/matches/${id}/docuseal`, {
      method: 'POST'
    }),
  signingStatus: (id: number) => request<{ docuseal: unknown }>(`/api/matches/${id}/signing-status`),
  adminMatches: () => request<Match[]>('/api/admin/matches'),
  syncCatigoal: () => request<Record<string, number>>('/api/admin/sync/catigoal', { method: 'POST' }),
  updateStatus: (id: number, status: string) =>
    request<Match>(`/api/admin/matches/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }),
  leagues: () => request<LeagueSettings[]>('/api/admin/leagues'),
  updateLeague: (id: number, body: Partial<LeagueSettings>) =>
    request<LeagueSettings>(`/api/admin/leagues/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
};

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  Check,
  Clock,
  Download,
  LogIn,
  Pause,
  Play,
  RefreshCcw,
  Save,
  Settings,
  Shield,
  Square,
  TimerReset,
  Users
} from 'lucide-react';
import { api, getAdminToken, setAdminToken } from './api';
import { beginLogin, completeLogin } from './auth';
import { bluetoothSupported, RobotBleController, type RobotSlot } from './ble';
import type { AuthConfig, Field, LeagueSettings, Match, MatchPrecheck, RobotCheck } from './types';

const fieldStorageKey = 'rcjv.selectedField';

type Screen = 'home' | 'precheck' | 'match' | 'signing';
type MatchStage = 'first_half' | 'half_time' | 'second_half' | 'full_time';

export default function App() {
  const path = window.location.pathname;
  if (path === '/admin/callback') return <AdminCallback />;
  if (path.startsWith('/admin')) return <AdminPanel />;
  return <TabletApp />;
}

function TabletApp() {
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedField, setSelectedField] = useState(localStorage.getItem(fieldStorageKey) ?? '');
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.fields().then(setFields).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (selectedField) localStorage.setItem(fieldStorageKey, selectedField);
  }, [selectedField]);

  useEffect(() => {
    if (!selectedField) return;
    setLoading(true);
    api
      .tabletMatches(selectedField)
      .then(setMatches)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedField]);

  async function refreshHome() {
    if (!selectedField) return;
    setLoading(true);
    try {
      setMatches(await api.tabletMatches(selectedField));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function selectMatch(match: Match) {
    setLoading(true);
    try {
      const loaded = await api.match(match.id);
      setActiveMatch(loaded);
      setScreen(loaded.score_sheet ? 'match' : 'precheck');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function returnHome() {
    setActiveMatch(null);
    setScreen('home');
    void refreshHome();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RCJV Paperless</div>
          <h1>{screen === 'home' ? 'Field Console' : `Match ${activeMatch?.number ?? ''}`}</h1>
        </div>
        <div className="topbar-actions">
          <a className="icon-link" href="/admin" title="Admin">
            <Shield size={20} />
            Admin
          </a>
          {screen !== 'home' && (
            <button className="secondary" onClick={returnHome}>
              Field Home
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {screen === 'home' && (
        <HomeScreen
          fields={fields}
          selectedField={selectedField}
          setSelectedField={setSelectedField}
          matches={matches}
          loading={loading}
          onRefresh={refreshHome}
          onSelect={selectMatch}
        />
      )}

      {activeMatch && screen === 'precheck' && (
        <PrecheckScreen
          match={activeMatch}
          onSaved={(match) => {
            setActiveMatch(match);
            setScreen('match');
          }}
          onError={setError}
        />
      )}

      {activeMatch && screen === 'match' && (
        <MatchMode
          match={activeMatch}
          onUpdate={setActiveMatch}
          onSigning={(match) => {
            setActiveMatch(match);
            setScreen('signing');
          }}
          onError={setError}
        />
      )}

      {activeMatch && screen === 'signing' && (
        <SigningScreen match={activeMatch} onRefresh={setActiveMatch} onDone={returnHome} onError={setError} />
      )}
    </div>
  );
}

function HomeScreen(props: {
  fields: Field[];
  selectedField: string;
  setSelectedField: (field: string) => void;
  matches: Match[];
  loading: boolean;
  onRefresh: () => void;
  onSelect: (match: Match) => void;
}) {
  return (
    <main className="workspace">
      <section className="toolbar-band">
        <label className="field-select">
          <span>Field</span>
          <select value={props.selectedField} onChange={(event) => props.setSelectedField(event.target.value)}>
            <option value="">Select field</option>
            {props.fields.map((field) => (
              <option key={field.id} value={field.name}>
                {field.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary icon-button" onClick={props.onRefresh} disabled={!props.selectedField || props.loading}>
          <RefreshCcw size={18} />
          Refresh
        </button>
      </section>

      <section className="match-grid">
        {props.matches.map((match) => (
          <button key={match.id} className="match-card" onClick={() => props.onSelect(match)}>
            <div className="match-card-head">
              <span className="pill">{match.league_name || match.league_abbrev}</span>
              <span className="muted">#{match.number}</span>
            </div>
            <strong>
              {match.team1_name || 'Team 1'} <span>vs</span> {match.team2_name || 'Team 2'}
            </strong>
            <div className="meta-row">
              <Clock size={16} />
              <span>{formatMatchTime(match)}</span>
            </div>
            <div className="meta-row">
              <Users size={16} />
              <span>{match.referees?.map((ref) => `${ref.first_name ?? ''} ${ref.last_name ?? ''}`.trim()).filter(Boolean).join(', ') || 'Referees open'}</span>
            </div>
            <div className="status-line">{statusLabel(match.status)}</div>
          </button>
        ))}
      </section>

      {props.selectedField && !props.loading && props.matches.length === 0 && <div className="empty-state">No open matches for {props.selectedField}.</div>}
      {!props.selectedField && <div className="empty-state">Select a field.</div>}
    </main>
  );
}

function PrecheckScreen({ match, onSaved, onError }: { match: Match; onSaved: (match: Match) => void; onError: (message: string) => void }) {
  const robotsPerTeam = match.league_settings.robots_per_team || 2;
  const schema = match.league_settings.checklist_schema;
  const [precheck, setPrecheck] = useState<MatchPrecheck>(() => match.score_sheet?.precheck || blankPrecheck(robotsPerTeam, schema));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.savePrecheck(match.id, precheck));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="workspace split-workspace">
      <section className="panel">
        <div className="section-head">
          <h2>Pre-Match Checks</h2>
          <button className="primary icon-button" onClick={save} disabled={saving}>
            <Save size={18} />
            Save
          </button>
        </div>
        <TeamRobotChecks
          teamLabel={match.team1_name || 'Team 1'}
          robots={precheck.teams.team1}
          schema={schema}
          onChange={(robots) => setPrecheck({ ...precheck, teams: { ...precheck.teams, team1: robots } })}
        />
        <TeamRobotChecks
          teamLabel={match.team2_name || 'Team 2'}
          robots={precheck.teams.team2}
          schema={schema}
          onChange={(robots) => setPrecheck({ ...precheck, teams: { ...precheck.teams, team2: robots } })}
        />
      </section>
      <section className="panel">
        <h2>Team Errors</h2>
        <label className="stacked-field">
          <span>{match.team1_name || 'Team 1'}</span>
          <textarea value={precheck.team_errors.team1} onChange={(event) => setPrecheck({ ...precheck, team_errors: { ...precheck.team_errors, team1: event.target.value } })} />
        </label>
        <label className="stacked-field">
          <span>{match.team2_name || 'Team 2'}</span>
          <textarea value={precheck.team_errors.team2} onChange={(event) => setPrecheck({ ...precheck, team_errors: { ...precheck.team_errors, team2: event.target.value } })} />
        </label>
      </section>
    </main>
  );
}

function TeamRobotChecks({
  teamLabel,
  robots,
  schema,
  onChange
}: {
  teamLabel: string;
  robots: RobotCheck[];
  schema: LeagueSettings['checklist_schema'];
  onChange: (robots: RobotCheck[]) => void;
}) {
  const checks = schema.robot_checks ?? [];

  function updateRobot(index: number, key: string, value: string | boolean | number) {
    const next = robots.map((robot, robotIndex) => (robotIndex === index ? { ...robot, [key]: value } : robot));
    onChange(next);
  }

  return (
    <div className="robot-table-wrap">
      <h3>{teamLabel}</h3>
      <table className="robot-table">
        <thead>
          <tr>
            <th>Check</th>
            {robots.map((_, index) => (
              <th key={index}>Robot {index + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.key}>
              <th>
                {check.label}
                {check.hint && <small>{check.hint}</small>}
              </th>
              {robots.map((robot, index) => (
                <td key={`${check.key}-${index}`}>
                  {check.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(robot[check.key])}
                      onChange={(event) => updateRobot(index, check.key, event.target.checked)}
                    />
                  ) : (
                    <input
                      value={String(robot[check.key] ?? '')}
                      onChange={(event) => updateRobot(index, check.key, event.target.value)}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchMode({
  match,
  onUpdate,
  onSigning,
  onError
}: {
  match: Match;
  onUpdate: (match: Match) => void;
  onSigning: (match: Match) => void;
  onError: (message: string) => void;
}) {
  const settings = match.league_settings;
  const slots = useMemo(() => buildSlots(settings.robots_per_team || 2), [settings.robots_per_team]);
  const controllerRef = useRef<RobotBleController | null>(null);
  const [bleVersion, setBleVersion] = useState(0);
  const [stage, setStage] = useState<MatchStage>('first_half');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(settings.period_seconds || 600);
  const [score1, setScore1] = useState(match.score_sheet?.final_goals1 ?? match.goals1 ?? 0);
  const [score2, setScore2] = useState(match.score_sheet?.final_goals2 ?? match.goals2 ?? 0);
  const [comments, setComments] = useState(match.score_sheet?.comments ?? '');
  const [saving, setSaving] = useState(false);

  if (!controllerRef.current) {
    controllerRef.current = new RobotBleController(slots);
    controllerRef.current.onPenaltyRequest = (slot) => void penalize(slot);
  }
  const controller = controllerRef.current;
  const connections = controller.list();
  const activeSlotIDs = slots.map((slot) => slot.id);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (remaining > 0 || !running) return;
    setRunning(false);
    if (stage === 'first_half') {
      setStage('half_time');
      setRemaining(settings.half_time_seconds || 300);
      void controller.halfTime(activeSlotIDs, settings.half_time_seconds || 300).catch((err: Error) => onError(err.message));
    } else if (stage === 'half_time') {
      setStage('second_half');
      setRemaining(settings.period_seconds || 600);
    } else if (stage === 'second_half') {
      setStage('full_time');
      void controller.gameOver(activeSlotIDs, score1, score2).catch((err: Error) => onError(err.message));
    }
  }, [remaining, running, stage, settings, controller, activeSlotIDs, score1, score2, onError]);

  async function pair(slotID: string) {
    try {
      await controller.pair(slotID);
      setBleVersion((value) => value + 1);
    } catch (err) {
      onError((err as Error).message);
      setBleVersion((value) => value + 1);
    }
  }

  async function startAll() {
    setRunning(true);
    await api.recordEvent(match.id, { type: 'start', stage, remaining });
    await controller.playAll(activeSlotIDs).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function stopAll() {
    setRunning(false);
    await api.recordEvent(match.id, { type: 'stop', stage, remaining });
    await controller.stopAll(activeSlotIDs).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function penalize(slot: RobotSlot) {
    await api.recordEvent(match.id, { type: 'robot_timeout', slot: slot.label, seconds: settings.penalty_seconds || 60 });
    await controller.penalty(slot.id, settings.penalty_seconds || 60).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function updateScore(team: 1 | 2, delta: number) {
    const next1 = Math.max(0, team === 1 ? score1 + delta : score1);
    const next2 = Math.max(0, team === 2 ? score2 + delta : score2);
    setScore1(next1);
    setScore2(next2);
    await api.recordEvent(match.id, { type: 'score', score1: next1, score2: next2 });
    await Promise.allSettled(slots.map((slot) => controller.score(slot.id, slot.team === 'team1' ? next1 : next2, slot.team === 'team1' ? next2 : next1)));
  }

  async function finish() {
    setSaving(true);
    setRunning(false);
    try {
      await controller.stopAll(activeSlotIDs).catch(() => undefined);
      const updated = await api.finishMatch(match.id, {
        final_goals1: score1,
        final_goals2: score2,
        penalty_goals1: 0,
        penalty_goals2: 0,
        kickoff_team: '',
        comments
      });
      onUpdate(updated);
      const signed = await api.createDocuSeal(updated.id);
      onSigning(signed);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="workspace match-workspace" data-ble-version={bleVersion}>
      <section className="score-band">
        <TeamScore name={match.team1_name || 'Team 1'} score={score1} onChange={(delta) => void updateScore(1, delta)} />
        <div className="clock-panel">
          <span className="pill">{stageLabel(stage)}</span>
          <strong>{formatSeconds(remaining)}</strong>
          <div className="clock-actions">
            <button className="primary icon-button" onClick={startAll} disabled={running || stage === 'full_time'}>
              <Play size={20} />
              Start
            </button>
            <button className="danger icon-button" onClick={stopAll} disabled={!running}>
              <Pause size={20} />
              Stop
            </button>
          </div>
        </div>
        <TeamScore name={match.team2_name || 'Team 2'} score={score2} onChange={(delta) => void updateScore(2, delta)} />
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Robot Control</h2>
          <span className={bluetoothSupported() ? 'pill ok' : 'pill warn'}>{bluetoothSupported() ? 'Web Bluetooth' : 'No Bluetooth'}</span>
        </div>
        <div className="robot-control-grid">
          {connections.map((connection) => (
            <div className="robot-control" key={connection.slot.id}>
              <div>
                <strong>{connection.slot.label}</strong>
                <span>{connection.status}</span>
              </div>
              <button className="secondary square-button" onClick={() => void pair(connection.slot.id)} title={`Pair ${connection.slot.label}`}>
                <Bluetooth size={18} />
              </button>
              <button className="warning square-button" onClick={() => void penalize(connection.slot)} title={`Timeout ${connection.slot.label}`}>
                <TimerReset size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Finish</h2>
          <button className="primary icon-button" onClick={finish} disabled={saving}>
            <Check size={18} />
            Submit
          </button>
        </div>
        <label className="stacked-field">
          <span>Comments</span>
          <textarea value={comments} onChange={(event) => setComments(event.target.value)} />
        </label>
      </section>
    </main>
  );
}

function TeamScore({ name, score, onChange }: { name: string; score: number; onChange: (delta: number) => void }) {
  return (
    <div className="team-score">
      <span>{name}</span>
      <strong>{score}</strong>
      <div className="score-actions">
        <button onClick={() => onChange(-1)}>-</button>
        <button onClick={() => onChange(1)}>+</button>
      </div>
    </div>
  );
}

function SigningScreen({ match, onRefresh, onDone, onError }: { match: Match; onRefresh: (match: Match) => void; onDone: () => void; onError: (message: string) => void }) {
  const [checking, setChecking] = useState(false);
  const links = match.docuseal?.signing_links ?? {};

  async function refresh() {
    setChecking(true);
    try {
      await api.signingStatus(match.id);
      const loaded = await api.match(match.id);
      onRefresh(loaded);
      if (loaded.status === 'signed') onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="workspace">
      <section className="panel signing-panel">
        <div className="section-head">
          <h2>Team Signatures</h2>
          <button className="secondary icon-button" onClick={refresh} disabled={checking}>
            <RefreshCcw size={18} />
            Refresh
          </button>
        </div>
        <div className="signing-links">
          {Object.entries(links).map(([role, url]) => (
            <a className="primary link-button" key={role} href={url} target="_blank" rel="noreferrer">
              <Download size={18} />
              {role}
            </a>
          ))}
        </div>
        <div className="status-line">Status: {match.docuseal?.status ?? match.status}</div>
      </section>
    </main>
  );
}

function AdminCallback() {
  const [message, setMessage] = useState('Signing in...');
  useEffect(() => {
    api
      .authConfig()
      .then(completeLogin)
      .catch((err: Error) => setMessage(err.message));
  }, []);
  return <div className="center-message">{message}</div>;
}

function AdminPanel() {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [tokenDraft, setTokenDraft] = useState(getAdminToken());
  const [matches, setMatches] = useState<Match[]>([]);
  const [leagues, setLeagues] = useState<LeagueSettings[]>([]);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    api.authConfig().then(setAuthConfig).catch((err: Error) => setError(err.message));
  }, []);

  async function load() {
    try {
      const [loadedMatches, loadedLeagues] = await Promise.all([api.adminMatches(), api.leagues()]);
      setMatches(loadedMatches);
      setLeagues(loadedLeagues);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      await api.syncCatigoal();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function saveLeague(league: LeagueSettings, robots: number) {
    try {
      const updated = await api.updateLeague(league.id, { robots_per_team: robots });
      setLeagues((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function markEntered(match: Match) {
    try {
      await api.updateStatus(match.id, 'entered_in_catigoal');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RCJV Paperless</div>
          <h1>Admin</h1>
        </div>
        <a className="icon-link" href="/">
          Field Console
        </a>
      </header>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      <main className="workspace admin-workspace">
        <section className="toolbar-band">
          <button className="primary icon-button" onClick={sync} disabled={syncing}>
            <RefreshCcw size={18} />
            Sync Catigoal
          </button>
          {!authConfig?.dev_allow && (
            <>
              <button className="secondary icon-button" onClick={() => authConfig && void beginLogin(authConfig)}>
                <LogIn size={18} />
                FusionAuth
              </button>
              <label className="token-input">
                <span>Bearer</span>
                <input
                  value={tokenDraft}
                  onChange={(event) => {
                    setTokenDraft(event.target.value);
                    setAdminToken(event.target.value);
                  }}
                />
              </label>
            </>
          )}
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>Leagues</h2>
            <Settings size={20} />
          </div>
          <div className="league-grid">
            {leagues.map((league) => (
              <LeagueSettingEditor key={league.id} league={league} onSave={saveLeague} />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>Matches</h2>
            <span className="pill">{matches.length}</span>
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Field</th>
                  <th>Teams</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matches.map((match) => (
                  <tr key={match.id}>
                    <td>#{match.number} {match.league_abbrev}</td>
                    <td>{match.field_name}</td>
                    <td>
                      {match.team1_name} vs {match.team2_name}
                    </td>
                    <td>{statusLabel(match.status)}</td>
                    <td>
                      {match.status === 'signed' && (
                        <button className="secondary icon-button" onClick={() => void markEntered(match)}>
                          <Square size={16} />
                          Entered
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function LeagueSettingEditor({ league, onSave }: { league: LeagueSettings; onSave: (league: LeagueSettings, robots: number) => void }) {
  const [robots, setRobots] = useState(league.robots_per_team);
  return (
    <div className="league-item">
      <strong>{league.league_name || league.league_abbrev}</strong>
      <label>
        <span>Robots</span>
        <input type="number" min={1} max={5} value={robots} onChange={(event) => setRobots(Number(event.target.value))} />
      </label>
      <button className="secondary icon-button" onClick={() => onSave(league, robots)}>
        <Save size={16} />
        Save
      </button>
    </div>
  );
}

function blankPrecheck(robotsPerTeam: number, schema: LeagueSettings['checklist_schema']): MatchPrecheck {
  const makeRobot = () =>
    Object.fromEntries((schema.robot_checks ?? []).map((check) => [check.key, check.type === 'boolean' ? false : ''])) as RobotCheck;
  return {
    teams: {
      team1: Array.from({ length: robotsPerTeam }, makeRobot),
      team2: Array.from({ length: robotsPerTeam }, makeRobot)
    },
    team_errors: {
      team1: '',
      team2: ''
    }
  };
}

function buildSlots(robotsPerTeam: number): RobotSlot[] {
  const slots: RobotSlot[] = [];
  for (let index = 0; index < robotsPerTeam; index += 1) slots.push({ id: `team1-${index}`, label: `A${index + 1}`, team: 'team1', index });
  for (let index = 0; index < robotsPerTeam; index += 1) slots.push({ id: `team2-${index}`, label: `B${index + 1}`, team: 'team2', index });
  return slots;
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatMatchTime(match: Match): string {
  if (match.start_at) {
    return new Date(match.start_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return match.start_raw || 'Time open';
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function stageLabel(stage: MatchStage): string {
  return statusLabel(stage);
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bluetooth,
  Check,
  Clock,
  Download,
  LogIn,
  LogOut,
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
import type { AuthConfig, Field, LeagueSettings, Match, MatchPrecheck, MatchRuntimeState, PenaltyTimers, RobotCheck } from './types';

const fieldStorageKey = 'rcjv.selectedField';

type Screen = 'home' | 'precheck' | 'match' | 'signing';
type MatchStage = 'first_half' | 'half_time' | 'second_half' | 'full_time';

export default function App() {
  const path = window.location.pathname;
  if (path === '/admin/callback') return <AdminCallback />;
  if (path.startsWith('/admin')) {
    return (
      <AuthGate area="Admin">
        <AdminPanel />
      </AuthGate>
    );
  }
  return (
    <AuthGate area="Field Console">
      <TabletApp />
    </AuthGate>
  );
}

function AuthGate({ area, children }: { area: string; children: ReactNode }) {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [tokenDraft, setTokenDraft] = useState(getAdminToken());
  const [error, setError] = useState('');

  useEffect(() => {
    api.authConfig().then(setAuthConfig).catch((err: Error) => setError(err.message));
  }, []);

  if (!authConfig) {
    return <div className="center-message">{error || 'Loading...'}</div>;
  }
  if (authConfig.dev_allow || getAdminToken()) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">RCJV Paperless</div>
          <h1>{area}</h1>
        </div>
      </header>
      <main className="workspace auth-workspace">
        <section className="panel auth-panel">
          <div className="section-head">
            <h2>Sign In</h2>
            <Shield size={20} />
          </div>
          {error && <div className="inline-error">{error}</div>}
          <button className="primary icon-button" onClick={() => void beginLogin(authConfig)} disabled={!authConfig.issuer || !authConfig.client_id}>
            <LogIn size={18} />
            FusionAuth
          </button>
          <label className="token-input">
            <span>Bearer Token</span>
            <input
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setAdminToken(tokenDraft);
                  window.location.reload();
                }
              }}
            />
          </label>
          <button
            className="secondary icon-button"
            onClick={() => {
              setAdminToken(tokenDraft);
              window.location.reload();
            }}
          >
            <Check size={18} />
            Use Token
          </button>
        </section>
      </main>
    </div>
  );
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
      .then((loaded) => setMatches(sortMatchesByStartTime(loaded)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedField]);

  async function refreshHome() {
    if (!selectedField) return;
    setLoading(true);
    try {
      setMatches(sortMatchesByStartTime(await api.tabletMatches(selectedField)));
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
          <button className="secondary icon-button" onClick={signOut}>
            <LogOut size={18} />
            Sign Out
          </button>
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
  const restoredState = useMemo(() => restoreRuntimeState(match, settings), [match, settings]);
  const controllerRef = useRef<RobotBleController | null>(null);
  const [bleVersion, setBleVersion] = useState(0);
  const [stage, setStage] = useState<MatchStage>(restoredState.stage);
  const [running, setRunning] = useState(restoredState.running);
  const [remaining, setRemaining] = useState(restoredState.remaining);
  const [score1, setScore1] = useState(restoredState.score1);
  const [score2, setScore2] = useState(restoredState.score2);
  const [comments, setComments] = useState(restoredState.comments);
  const [penaltyTimers, setPenaltyTimers] = useState<PenaltyTimers>(restoredState.penalty_timers);
  const [saving, setSaving] = useState(false);
  const liveStateRef = useRef<MatchRuntimeState>(restoredState);

  if (!controllerRef.current) {
    controllerRef.current = new RobotBleController(slots);
    controllerRef.current.onPenaltyRequest = (slot) => void penalize(slot);
  }
  const controller = controllerRef.current;
  const connections = controller.list();
  const activeSlotIDs = useMemo(() => slots.map((slot) => slot.id), [slots]);
  const penaltyTimerKey = useMemo(() => JSON.stringify(penaltyTimers), [penaltyTimers]);
  const hasActivePenalty = useMemo(() => Object.values(penaltyTimers).some((seconds) => seconds > 0), [penaltyTimerKey]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!hasActivePenalty) return;
    const timer = window.setInterval(() => {
      setPenaltyTimers((current) => {
        const next: PenaltyTimers = {};
        for (const [slotID, seconds] of Object.entries(current)) {
          const remainingSeconds = Math.max(0, seconds - 1);
          if (remainingSeconds > 0) next[slotID] = remainingSeconds;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActivePenalty]);

  useEffect(() => {
    liveStateRef.current = runtimeState(stage, running, remaining, score1, score2, comments, penaltyTimers);
  }, [stage, running, remaining, score1, score2, comments, penaltyTimerKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void persistCurrentState().catch((err: Error) => onError(err.message));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [match.id, stage, running, score1, score2, comments, penaltyTimerKey]);

  useEffect(() => {
    if (!running && !hasActivePenalty) return;
    const timer = window.setInterval(() => {
      void persistCurrentState().catch((err: Error) => onError(err.message));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [running, hasActivePenalty, match.id]);

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

  async function persistCurrentState() {
    const snapshot = { ...liveStateRef.current, saved_at: new Date().toISOString() };
    liveStateRef.current = snapshot;
    await api.saveMatchState(match.id, snapshot);
  }

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

  async function resetTimer() {
    const nextRemaining = stageDuration(stage, settings);
    const snapshot = runtimeState(stage, false, nextRemaining, score1, score2, comments, penaltyTimers);
    setRunning(false);
    setRemaining(nextRemaining);
    liveStateRef.current = snapshot;
    await api.recordEvent(match.id, { type: 'timer_reset', stage, remaining: nextRemaining });
    await api.saveMatchState(match.id, snapshot);
  }

  async function playRobots() {
    await api.recordEvent(match.id, { type: 'bluetooth_play_all', stage, remaining });
    await controller.playAll(activeSlotIDs).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function stopRobots() {
    await api.recordEvent(match.id, { type: 'bluetooth_stop_all', stage, remaining });
    await controller.stopAll(activeSlotIDs).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function penalize(slot: RobotSlot) {
    const seconds = settings.penalty_seconds || 60;
    setPenaltyTimers((current) => ({ ...current, [slot.id]: seconds }));
    await api.recordEvent(match.id, { type: 'robot_timeout', slot: slot.label, seconds });
    await controller.penalty(slot.id, seconds).catch((err: Error) => onError(err.message));
    setBleVersion((value) => value + 1);
  }

  async function resetPenalty(slot: RobotSlot) {
    const nextTimers = { ...penaltyTimers };
    delete nextTimers[slot.id];
    const snapshot = runtimeState(stage, running, remaining, score1, score2, comments, nextTimers);
    setPenaltyTimers(nextTimers);
    liveStateRef.current = snapshot;
    await api.recordEvent(match.id, { type: 'robot_timeout_reset', slot: slot.label });
    await api.saveMatchState(match.id, snapshot);
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
      await persistCurrentState();
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
            <button className="secondary icon-button" onClick={() => void resetTimer()} disabled={stage === 'full_time'}>
              <TimerReset size={20} />
              Reset
            </button>
          </div>
        </div>
        <TeamScore name={match.team2_name || 'Team 2'} score={score2} onChange={(delta) => void updateScore(2, delta)} />
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Robot Control</h2>
          <div className="section-actions">
            <span className={bluetoothSupported() ? 'pill ok' : 'pill warn'}>{bluetoothSupported() ? 'Web Bluetooth' : 'No Bluetooth'}</span>
            <button className="secondary icon-button" onClick={() => void playRobots()}>
              <Play size={18} />
              Play All
            </button>
            <button className="danger icon-button" onClick={() => void stopRobots()}>
              <Pause size={18} />
              Stop All
            </button>
          </div>
        </div>
        <div className="robot-control-grid">
          {connections.map((connection) => (
            <div className="robot-control" key={connection.slot.id}>
              <div>
                <strong>{connection.slot.label}</strong>
                <span>{connection.status}</span>
              </div>
              <div className={penaltyTimers[connection.slot.id] ? 'penalty-countdown active' : 'penalty-countdown'}>
                {penaltyTimers[connection.slot.id] ? formatSeconds(penaltyTimers[connection.slot.id]) : 'Ready'}
              </div>
              <button className="secondary square-button" onClick={() => void pair(connection.slot.id)} title={`Pair ${connection.slot.label}`}>
                <Bluetooth size={18} />
              </button>
              <button className="warning square-button" onClick={() => void penalize(connection.slot)} title={`Timeout ${connection.slot.label}`}>
                <TimerReset size={18} />
              </button>
              <button
                className="secondary square-button"
                onClick={() => void resetPenalty(connection.slot)}
                disabled={!penaltyTimers[connection.slot.id]}
                title={`Reset timeout ${connection.slot.label}`}
              >
                <RefreshCcw size={18} />
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
  const [matches, setMatches] = useState<Match[]>([]);
  const [leagues, setLeagues] = useState<LeagueSettings[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [loadedMatches, loadedLeagues] = await Promise.all([api.adminMatches(), api.leagues()]);
      setMatches(sortMatchesByStartTime(loadedMatches));
      setLeagues(loadedLeagues);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    async function initialLoad() {
      await load();
      if (!disposed) void sync();
    }
    void initialLoad();
    const interval = window.setInterval(() => {
      if (!document.hidden) void sync();
    }, 60000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  async function sync() {
    setSyncing(true);
    try {
      const stats = await api.syncCatigoal();
      setLastSync(`${stats.matches ?? 0} matches, ${stats.fields ?? 0} fields`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function saveLeague(league: LeagueSettings, body: Partial<LeagueSettings>) {
    try {
      const updated = await api.updateLeague(league.id, body);
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
        <div className="topbar-actions">
          <a className="icon-link" href="/">
            Field Console
          </a>
          <button className="secondary icon-button" onClick={signOut}>
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
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
            {syncing ? 'Syncing' : 'Sync Catigoal'}
          </button>
          <button className="secondary icon-button" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={18} />
            Refresh
          </button>
          <span className="pill">{lastSync || (loading ? 'Loading' : 'Auto sync on')}</span>
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
            <span className="pill">{loading ? 'Loading' : matches.length}</span>
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Start</th>
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
                    <td>{formatMatchTime(match)}</td>
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

function LeagueSettingEditor({ league, onSave }: { league: LeagueSettings; onSave: (league: LeagueSettings, body: Partial<LeagueSettings>) => void }) {
  const [robots, setRobots] = useState(league.robots_per_team);
  const [periodSeconds, setPeriodSeconds] = useState(league.period_seconds);
  const [halfTimeSeconds, setHalfTimeSeconds] = useState(league.half_time_seconds);
  const [penaltySeconds, setPenaltySeconds] = useState(league.penalty_seconds);
  const [checklistSchema, setChecklistSchema] = useState(JSON.stringify(league.checklist_schema ?? {}, null, 2));
  const [jsonError, setJsonError] = useState('');

  useEffect(() => {
    setRobots(league.robots_per_team);
    setPeriodSeconds(league.period_seconds);
    setHalfTimeSeconds(league.half_time_seconds);
    setPenaltySeconds(league.penalty_seconds);
    setChecklistSchema(JSON.stringify(league.checklist_schema ?? {}, null, 2));
  }, [league]);

  function save() {
    try {
      const parsed = JSON.parse(checklistSchema);
      setJsonError('');
      onSave(league, {
        robots_per_team: robots,
        period_seconds: periodSeconds,
        half_time_seconds: halfTimeSeconds,
        penalty_seconds: penaltySeconds,
        checklist_schema: parsed
      });
    } catch (err) {
      setJsonError((err as Error).message);
    }
  }

  return (
    <div className="league-item">
      <strong>{league.league_name || league.league_abbrev}</strong>
      <label>
        <span>Robots</span>
        <input type="number" min={1} max={5} value={robots} onChange={(event) => setRobots(Number(event.target.value))} />
      </label>
      <label>
        <span>Period</span>
        <input type="number" min={60} max={3600} value={periodSeconds} onChange={(event) => setPeriodSeconds(Number(event.target.value))} />
      </label>
      <label>
        <span>Half Time</span>
        <input type="number" min={0} max={1800} value={halfTimeSeconds} onChange={(event) => setHalfTimeSeconds(Number(event.target.value))} />
      </label>
      <label>
        <span>Penalty</span>
        <input type="number" min={0} max={600} value={penaltySeconds} onChange={(event) => setPenaltySeconds(Number(event.target.value))} />
      </label>
      <label className="schema-field">
        <span>Checklist JSON</span>
        <textarea value={checklistSchema} onChange={(event) => setChecklistSchema(event.target.value)} />
      </label>
      {jsonError && <div className="inline-error">{jsonError}</div>}
      <button className="secondary icon-button" onClick={save}>
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

function runtimeState(
  stage: MatchStage,
  running: boolean,
  remaining: number,
  score1: number,
  score2: number,
  comments: string,
  penaltyTimers: PenaltyTimers
): MatchRuntimeState {
  const activePenalties: PenaltyTimers = {};
  for (const [slotID, seconds] of Object.entries(penaltyTimers)) {
    if (Number.isFinite(seconds) && seconds > 0) activePenalties[slotID] = Math.floor(seconds);
  }
  return {
    stage,
    running,
    remaining: Math.max(0, Math.floor(remaining)),
    score1: Math.max(0, Math.floor(score1)),
    score2: Math.max(0, Math.floor(score2)),
    comments,
    penalty_timers: activePenalties,
    saved_at: new Date().toISOString()
  };
}

function restoreRuntimeState(match: Match, settings: LeagueSettings): MatchRuntimeState {
  const fallback = runtimeState(
    'first_half',
    false,
    settings.period_seconds || 600,
    match.score_sheet?.final_goals1 ?? match.goals1 ?? 0,
    match.score_sheet?.final_goals2 ?? match.goals2 ?? 0,
    match.score_sheet?.comments ?? '',
    {}
  );
  const saved = match.score_sheet?.state;
  if (!saved) return fallback;

  const savedAt = Date.parse(saved.saved_at || '');
  const elapsed = Number.isFinite(savedAt) ? Math.max(0, Math.floor((Date.now() - savedAt) / 1000)) : 0;
  const stage = isMatchStage(saved.stage) ? saved.stage : fallback.stage;
  const running = Boolean(saved.running) && stage !== 'full_time';
  return {
    stage,
    running,
    remaining: Math.max(0, numberOr(saved.remaining, fallback.remaining) - (running ? elapsed : 0)),
    score1: numberOr(saved.score1, fallback.score1),
    score2: numberOr(saved.score2, fallback.score2),
    comments: typeof saved.comments === 'string' ? saved.comments : fallback.comments,
    penalty_timers: restorePenaltyTimers(saved.penalty_timers, elapsed),
    saved_at: new Date().toISOString()
  };
}

function restorePenaltyTimers(saved: PenaltyTimers | undefined, elapsed: number): PenaltyTimers {
  const timers: PenaltyTimers = {};
  for (const [slotID, seconds] of Object.entries(saved ?? {})) {
    const remaining = Math.max(0, numberOr(seconds, 0) - elapsed);
    if (remaining > 0) timers[slotID] = remaining;
  }
  return timers;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isMatchStage(value: unknown): value is MatchStage {
  return value === 'first_half' || value === 'half_time' || value === 'second_half' || value === 'full_time';
}

function signOut() {
  setAdminToken('');
  window.location.reload();
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

function sortMatchesByStartTime(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const byStart = matchStartValue(a) - matchStartValue(b);
    if (byStart !== 0) return byStart;
    if (a.number !== b.number) return a.number - b.number;
    return a.id - b.id;
  });
}

function matchStartValue(match: Match): number {
  const parsed = Date.parse(match.start_at || match.start_raw || '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

function stageLabel(stage: MatchStage): string {
  return statusLabel(stage);
}

function stageDuration(stage: MatchStage, settings: LeagueSettings): number {
  if (stage === 'half_time') return settings.half_time_seconds || 300;
  if (stage === 'full_time') return 0;
  return settings.period_seconds || 600;
}

export type Field = {
  id: number;
  name: string;
  sort_order: number;
};

export type ChecklistSchema = {
  robot_checks?: Array<{
    key: string;
    label: string;
    type: 'text' | 'boolean' | 'number';
    hint?: string;
  }>;
  team_fields?: Array<{
    key: string;
    label: string;
    type: string;
    options?: string[];
  }>;
  comments?: boolean;
};

export type LeagueSettings = {
  id: number;
  league_abbrev: string;
  league_name: string;
  robots_per_team: number;
  period_seconds: number;
  half_time_seconds: number;
  penalty_seconds: number;
  checklist_schema: ChecklistSchema;
};

export type ScoreSheet = {
  id: number;
  precheck: MatchPrecheck;
  events: unknown[];
  comments: string;
  kickoff_team: string;
  penalty_goals1: number;
  penalty_goals2: number;
  final_goals1: number;
  final_goals2: number;
  submitted_at?: string;
};

export type DocuSealState = {
  id: number;
  submission_id: string;
  status: string;
  submitters: Array<{ role?: string; name?: string; status?: string; embed_src?: string }>;
  signing_links: Record<string, string>;
  audit_log_url?: string;
  combined_document_url?: string;
  completed_at?: string;
};

export type Match = {
  id: number;
  external_key: string;
  number: number;
  league_abbrev: string;
  league_name: string;
  stage_name: string;
  group_name: string;
  field_name: string;
  start_raw: string;
  start_at?: string;
  duration_raw: string;
  duration_sec: number;
  team1_name: string;
  team2_name: string;
  goals1: number;
  goals2: number;
  status: string;
  referees: Array<{ first_name?: string; last_name?: string }>;
  score_sheet?: ScoreSheet | null;
  docuseal?: DocuSealState | null;
  league_settings: LeagueSettings;
};

export type RobotCheck = Record<string, string | boolean | number>;

export type MatchPrecheck = {
  teams: {
    team1: RobotCheck[];
    team2: RobotCheck[];
  };
  team_errors: {
    team1: string;
    team2: string;
  };
};

export type AuthConfig = {
  issuer: string;
  client_id: string;
  required_role: string;
  dev_allow: boolean;
};

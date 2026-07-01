package database

import "time"

const (
	MatchStatusImported        = "imported"
	MatchStatusPrecheckStarted = "precheck_started"
	MatchStatusInMatch         = "in_match"
	MatchStatusFinished        = "match_finished"
	MatchStatusDocuSealPending = "docuseal_pending"
	MatchStatusSigned          = "signed"
	MatchStatusEnteredCatigoal = "entered_in_catigoal"
	MatchStatusCancelled       = "cancelled"
)

type Field struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type LeagueSetting struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	LeagueAbbrev    string    `gorm:"uniqueIndex;not null" json:"league_abbrev"`
	LeagueName      string    `json:"league_name"`
	RobotsPerTeam   int       `gorm:"not null;default:2" json:"robots_per_team"`
	PeriodSeconds   int       `gorm:"not null;default:600" json:"period_seconds"`
	HalfTimeSeconds int       `gorm:"not null;default:300" json:"half_time_seconds"`
	PenaltySeconds  int       `gorm:"not null;default:60" json:"penalty_seconds"`
	ChecklistSchema string    `gorm:"type:text" json:"checklist_schema"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type ImportedMatch struct {
	ID uint `gorm:"primaryKey" json:"id"`

	ExternalKey   string `gorm:"uniqueIndex;not null" json:"external_key"`
	Number        int    `gorm:"index" json:"number"`
	LeagueAbbrev  string `gorm:"index" json:"league_abbrev"`
	LeagueName    string `json:"league_name"`
	StageName     string `json:"stage_name"`
	GroupName     string `json:"group_name"`
	FieldName     string `gorm:"index" json:"field_name"`
	StartRaw      string `json:"start_raw"`
	StartAt       *time.Time
	DurationRaw   string `json:"duration_raw"`
	DurationSec   int    `json:"duration_sec"`
	Team1ID       string `json:"team1_id"`
	Team1Name     string `json:"team1_name"`
	Team2ID       string `json:"team2_id"`
	Team2Name     string `json:"team2_name"`
	Goals1        int    `json:"goals1"`
	Goals2        int    `json:"goals2"`
	Points1       int    `json:"points1"`
	Points2       int    `json:"points2"`
	RefereesJSON  string `gorm:"type:text" json:"referees_json"`
	LastPublished string `json:"last_published"`

	Status    string     `gorm:"index;not null;default:imported" json:"status"`
	SignedAt  *time.Time `json:"signed_at"`
	EnteredAt *time.Time `json:"entered_at"`

	ScoreSheet ScoreSheet `json:"score_sheet,omitempty"`
	DocuSeal   DocuSealSubmission
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type ScoreSheet struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	MatchID uint `gorm:"uniqueIndex;not null" json:"match_id"`

	PrecheckJSON  string `gorm:"type:text" json:"precheck_json"`
	EventsJSON    string `gorm:"type:text" json:"events_json"`
	Comments      string `gorm:"type:text" json:"comments"`
	KickoffTeam   string `json:"kickoff_team"`
	PenaltyGoals1 int    `json:"penalty_goals1"`
	PenaltyGoals2 int    `json:"penalty_goals2"`
	FinalGoals1   int    `json:"final_goals1"`
	FinalGoals2   int    `json:"final_goals2"`
	SubmittedAt   *time.Time

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DocuSealSubmission struct {
	ID      uint `gorm:"primaryKey" json:"id"`
	MatchID uint `gorm:"uniqueIndex;not null" json:"match_id"`

	SubmissionID        string `gorm:"index" json:"submission_id"`
	Status              string `gorm:"index" json:"status"`
	SubmittersJSON      string `gorm:"type:text" json:"submitters_json"`
	SigningLinksJSON    string `gorm:"type:text" json:"signing_links_json"`
	AuditLogURL         string `json:"audit_log_url"`
	CombinedDocumentURL string `json:"combined_document_url"`
	LastPayloadJSON     string `gorm:"type:text" json:"last_payload_json"`
	CompletedAt         *time.Time

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

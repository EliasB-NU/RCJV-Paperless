package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"RCJV-Paperless/internal/data"
	"RCJV-Paperless/internal/database"
	"RCJV-Paperless/internal/integration"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type statusPatchRequest struct {
	Status string `json:"status"`
}

type leagueSettingsPatch struct {
	RobotsPerTeam   *int `json:"robots_per_team"`
	PeriodSeconds   *int `json:"period_seconds"`
	HalfTimeSeconds *int `json:"half_time_seconds"`
	PenaltySeconds  *int `json:"penalty_seconds"`
	ChecklistSchema any  `json:"checklist_schema"`
}

func (a *API) syncCatigoal(c *fiber.Ctx) error {
	if a.CFG.Catigoal.BaseURL == "" {
		return fail(fiber.StatusServiceUnavailable, "Catigoal base_url is not configured")
	}

	leagues := data.GetLeagues(a.CFG.Catigoal.BaseURL)
	if leagues == nil {
		return fail(fiber.StatusBadGateway, "failed to fetch Catigoal leagues")
	}
	leagues = data.GetMatches(a.CFG.Catigoal.BaseURL, leagues)

	stats := fiber.Map{
		"leagues": 0,
		"matches": 0,
		"fields":  0,
	}
	fieldSet := map[string]bool{}

	err := a.DB.Transaction(func(tx *gorm.DB) error {
		for leagueIndex, league := range leagues.Leagues {
			stats["leagues"] = stats["leagues"].(int) + 1
			if err := upsertLeagueSetting(tx, league.LeagueAbbreviation, league.LeagueName); err != nil {
				return err
			}
			for stageIndex, stage := range league.Stages {
				for _, sourceMatch := range stage.Matches {
					fieldName := ""
					if sourceMatch.Pitch != nil {
						fieldName = strings.TrimSpace(*sourceMatch.Pitch)
					}
					if fieldName != "" {
						if err := upsertField(tx, fieldName); err != nil {
							return err
						}
						fieldSet[fieldName] = true
					}

					imported := importedMatchFromCatigoal(sourceMatch, league.LeagueAbbreviation, league.LeagueName, stage.Name, leagueIndex, stageIndex)
					imported.FieldName = fieldName
					if err := upsertImportedMatch(tx, imported); err != nil {
						return err
					}
					stats["matches"] = stats["matches"].(int) + 1
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	stats["fields"] = len(fieldSet)
	return c.JSON(stats)
}

func (a *API) listAdminMatches(c *fiber.Ctx) error {
	query := a.DB.Preload("ScoreSheet").Preload("DocuSeal")
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if field := c.Query("field"); field != "" {
		query = query.Where("field_name = ?", field)
	}
	if league := c.Query("league"); league != "" {
		query = query.Where("league_abbrev = ?", league)
	}
	var matches []database.ImportedMatch
	if err := query.Order("start_at asc nulls last, number asc").Find(&matches).Error; err != nil {
		return err
	}
	return c.JSON(a.matchesToDTO(matches))
}

func (a *API) updateMatchStatus(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req statusPatchRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid status payload")
	}
	if !validMatchStatus(req.Status) {
		return fail(fiber.StatusBadRequest, "invalid match status")
	}
	updates := map[string]any{"status": req.Status}
	now := time.Now().UTC()
	if req.Status == database.MatchStatusSigned {
		updates["signed_at"] = now
	}
	if req.Status == database.MatchStatusEnteredCatigoal {
		updates["entered_at"] = now
	}
	if err := a.DB.Model(&database.ImportedMatch{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return err
	}
	return a.getMatch(c)
}

func (a *API) listLeagues(c *fiber.Ctx) error {
	var leagues []database.LeagueSetting
	if err := a.DB.Order("league_abbrev asc").Find(&leagues).Error; err != nil {
		return err
	}
	return c.JSON(leagues)
}

func (a *API) updateLeagueSettings(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req leagueSettingsPatch
	if err := c.BodyParser(&req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid league settings payload")
	}
	var league database.LeagueSetting
	if err := a.DB.First(&league, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fail(fiber.StatusNotFound, "league settings not found")
		}
		return err
	}
	if req.RobotsPerTeam != nil {
		league.RobotsPerTeam = clamp(*req.RobotsPerTeam, 1, 5)
	}
	if req.PeriodSeconds != nil {
		league.PeriodSeconds = clamp(*req.PeriodSeconds, 60, 3600)
	}
	if req.HalfTimeSeconds != nil {
		league.HalfTimeSeconds = clamp(*req.HalfTimeSeconds, 0, 1800)
	}
	if req.PenaltySeconds != nil {
		league.PenaltySeconds = clamp(*req.PenaltySeconds, 0, 600)
	}
	if req.ChecklistSchema != nil {
		raw, err := jsonString(req.ChecklistSchema)
		if err != nil {
			return err
		}
		league.ChecklistSchema = raw
	}
	if err := a.DB.Save(&league).Error; err != nil {
		return err
	}
	return c.JSON(league)
}

func (a *API) getDocuSealSubmission(c *fiber.Ctx) error {
	submissionID := c.Params("id")
	client := integration.NewDocuSealClient(a.CFG)
	if !client.Configured() {
		return fail(fiber.StatusServiceUnavailable, "DocuSeal is not configured")
	}
	submission, err := client.GetSubmission(c.Context(), submissionID)
	if err != nil {
		return fail(fiber.StatusBadGateway, err.Error())
	}
	return c.JSON(submission)
}

func (a *API) refreshDocuSealSubmission(c *fiber.Ctx) error {
	submissionID := c.Params("id")
	var doc database.DocuSealSubmission
	if err := a.DB.Where("submission_id = ?", submissionID).First(&doc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fail(fiber.StatusNotFound, "stored DocuSeal submission not found")
		}
		return err
	}
	client := integration.NewDocuSealClient(a.CFG)
	if !client.Configured() {
		return fail(fiber.StatusServiceUnavailable, "DocuSeal is not configured")
	}
	submission, err := client.GetSubmission(c.Context(), submissionID)
	if err != nil {
		return fail(fiber.StatusBadGateway, err.Error())
	}
	if err := a.applyDocuSealSubmission(&doc, submission); err != nil {
		return err
	}
	return c.JSON(docuSealJSON(doc))
}

func upsertLeagueSetting(tx *gorm.DB, abbrev string, name string) error {
	var setting database.LeagueSetting
	err := tx.Where("league_abbrev = ?", abbrev).First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		setting = database.LeagueSetting{
			LeagueAbbrev:    abbrev,
			LeagueName:      name,
			RobotsPerTeam:   2,
			PeriodSeconds:   600,
			HalfTimeSeconds: 300,
			PenaltySeconds:  60,
			ChecklistSchema: defaultChecklistSchema(),
		}
		return tx.Create(&setting).Error
	}
	if err != nil {
		return err
	}
	updates := map[string]any{"league_name": name}
	if setting.ChecklistSchema == "" {
		updates["checklist_schema"] = defaultChecklistSchema()
	}
	return tx.Model(&setting).Updates(updates).Error
}

func upsertField(tx *gorm.DB, name string) error {
	var field database.Field
	err := tx.Where("name = ?", name).First(&field).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		field = database.Field{Name: name}
		return tx.Create(&field).Error
	}
	return err
}

func importedMatchFromCatigoal(source data.Match, leagueAbbrev, leagueName, stageName string, leagueIndex, stageIndex int) database.ImportedMatch {
	groupName := ""
	if source.GroupName != nil {
		groupName = *source.GroupName
	}
	startRaw := ""
	if source.Start != nil {
		startRaw = *source.Start
	}
	durationRaw := ""
	if source.Duration != nil {
		durationRaw = *source.Duration
	}
	team1ID, team1Name := teamData(source.Team1)
	team2ID, team2Name := teamData(source.Team2)
	refereesJSON, _ := json.Marshal(source.Referees)

	return database.ImportedMatch{
		ExternalKey:   fmt.Sprintf("%s:%d:%d", leagueAbbrev, stageIndex, source.Number),
		Number:        source.Number,
		LeagueAbbrev:  leagueAbbrev,
		LeagueName:    leagueName,
		StageName:     stageName,
		GroupName:     groupName,
		StartRaw:      startRaw,
		StartAt:       parseCatigoalTime(startRaw),
		DurationRaw:   durationRaw,
		DurationSec:   parseDurationSeconds(durationRaw),
		Team1ID:       team1ID,
		Team1Name:     team1Name,
		Team2ID:       team2ID,
		Team2Name:     team2Name,
		Goals1:        source.Goals1,
		Goals2:        source.Goals2,
		Points1:       source.Points1,
		Points2:       source.Points2,
		RefereesJSON:  string(refereesJSON),
		LastPublished: source.LastPublished,
		Status:        database.MatchStatusImported,
	}
}

func teamData(team *data.Team) (string, string) {
	if team == nil {
		return "", ""
	}
	return strconv.Itoa(team.ID), team.Name
}

func upsertImportedMatch(tx *gorm.DB, incoming database.ImportedMatch) error {
	var existing database.ImportedMatch
	err := tx.Where("external_key = ?", incoming.ExternalKey).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return tx.Create(&incoming).Error
	}
	if err != nil {
		return err
	}
	incoming.ID = existing.ID
	incoming.Status = existing.Status
	incoming.SignedAt = existing.SignedAt
	incoming.EnteredAt = existing.EnteredAt
	if existing.Status == "" {
		incoming.Status = database.MatchStatusImported
	}
	return tx.Model(&existing).Updates(map[string]any{
		"number":         incoming.Number,
		"league_abbrev":  incoming.LeagueAbbrev,
		"league_name":    incoming.LeagueName,
		"stage_name":     incoming.StageName,
		"group_name":     incoming.GroupName,
		"field_name":     incoming.FieldName,
		"start_raw":      incoming.StartRaw,
		"start_at":       incoming.StartAt,
		"duration_raw":   incoming.DurationRaw,
		"duration_sec":   incoming.DurationSec,
		"team1_id":       incoming.Team1ID,
		"team1_name":     incoming.Team1Name,
		"team2_id":       incoming.Team2ID,
		"team2_name":     incoming.Team2Name,
		"points1":        incoming.Points1,
		"points2":        incoming.Points2,
		"referees_json":  incoming.RefereesJSON,
		"last_published": incoming.LastPublished,
		"status":         incoming.Status,
	}).Error
}

func validMatchStatus(status string) bool {
	switch status {
	case database.MatchStatusImported,
		database.MatchStatusPrecheckStarted,
		database.MatchStatusInMatch,
		database.MatchStatusFinished,
		database.MatchStatusDocuSealPending,
		database.MatchStatusSigned,
		database.MatchStatusEnteredCatigoal,
		database.MatchStatusCancelled:
		return true
	default:
		return false
	}
}

func clamp(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

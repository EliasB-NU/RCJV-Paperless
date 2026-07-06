package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"RCJV-Paperless/internal/database"
	"RCJV-Paperless/internal/integration"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type matchDTO struct {
	database.ImportedMatch
	StartAt        *time.Time `json:"start_at"`
	Referees       any        `json:"referees"`
	ScoreSheet     any        `json:"score_sheet"`
	DocuSeal       any        `json:"docuseal"`
	LeagueSettings any        `json:"league_settings"`
}

type precheckRequest struct {
	Precheck any `json:"precheck"`
}

type matchEventRequest struct {
	Event any `json:"event"`
}

type finishMatchRequest struct {
	FinalGoals1   int    `json:"final_goals1"`
	FinalGoals2   int    `json:"final_goals2"`
	PenaltyGoals1 int    `json:"penalty_goals1"`
	PenaltyGoals2 int    `json:"penalty_goals2"`
	KickoffTeam   string `json:"kickoff_team"`
	Comments      string `json:"comments"`
	Precheck      any    `json:"precheck"`
	Events        any    `json:"events"`
}

type matchStateRequest struct {
	State       json.RawMessage `json:"state"`
	FinalGoals1 *int            `json:"final_goals1"`
	FinalGoals2 *int            `json:"final_goals2"`
	Comments    *string         `json:"comments"`
}

func (a *API) listFields(c *fiber.Ctx) error {
	var fields []database.Field
	if err := a.DB.Order("sort_order asc, name asc").Find(&fields).Error; err != nil {
		return err
	}
	return c.JSON(fields)
}

func (a *API) listTabletMatches(c *fiber.Ctx) error {
	field := c.Query("field")
	if field == "" {
		return fail(fiber.StatusBadRequest, "field query parameter is required")
	}
	hidden := []string{
		database.MatchStatusSigned,
		database.MatchStatusEnteredCatigoal,
		database.MatchStatusCancelled,
	}

	var matches []database.ImportedMatch
	if err := a.DB.
		Preload("ScoreSheet").
		Preload("DocuSeal").
		Where("field_name = ?", field).
		Where("status NOT IN ?", hidden).
		Order("start_at asc nulls last, number asc").
		Find(&matches).Error; err != nil {
		return err
	}

	return c.JSON(a.matchesToDTO(matches))
}

func (a *API) getMatch(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	match, err := a.loadMatch(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fail(fiber.StatusNotFound, "match not found")
		}
		return err
	}
	return c.JSON(a.matchToDTO(*match))
}

func (a *API) savePrecheck(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req precheckRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid precheck payload")
	}
	raw, err := jsonString(req.Precheck)
	if err != nil {
		return err
	}

	sheet, err := ensureScoreSheet(a.DB, id)
	if err != nil {
		return err
	}
	sheet.PrecheckJSON = raw
	if err := a.DB.Save(sheet).Error; err != nil {
		return err
	}
	if err := advanceMatchStatus(a.DB, id, database.MatchStatusPrecheckStarted); err != nil {
		return err
	}
	return a.getMatch(c)
}

func (a *API) recordMatchEvent(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req matchEventRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid event payload")
	}

	sheet, err := ensureScoreSheet(a.DB, id)
	if err != nil {
		return err
	}
	var events []any
	if sheet.EventsJSON != "" {
		_ = json.Unmarshal([]byte(sheet.EventsJSON), &events)
	}
	event := map[string]any{
		"at":    time.Now().UTC().Format(time.RFC3339Nano),
		"event": req.Event,
	}
	events = append(events, event)
	raw, err := jsonString(events)
	if err != nil {
		return err
	}
	sheet.EventsJSON = raw
	if err := a.DB.Save(sheet).Error; err != nil {
		return err
	}
	if err := advanceMatchStatus(a.DB, id, database.MatchStatusInMatch); err != nil {
		return err
	}
	return a.getMatch(c)
}

func (a *API) saveMatchState(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req matchStateRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid match state payload")
	}

	sheet, err := ensureScoreSheet(a.DB, id)
	if err != nil {
		return err
	}
	if len(req.State) > 0 && string(req.State) != "null" {
		if !json.Valid(req.State) {
			return fail(fiber.StatusBadRequest, "invalid match state JSON")
		}
		sheet.StateJSON = string(req.State)
	}
	if req.Comments != nil {
		sheet.Comments = *req.Comments
	}
	if req.FinalGoals1 != nil {
		sheet.FinalGoals1 = *req.FinalGoals1
	}
	if req.FinalGoals2 != nil {
		sheet.FinalGoals2 = *req.FinalGoals2
	}
	if err := a.DB.Save(sheet).Error; err != nil {
		return err
	}

	updates := map[string]any{}
	if req.FinalGoals1 != nil {
		updates["goals1"] = *req.FinalGoals1
	}
	if req.FinalGoals2 != nil {
		updates["goals2"] = *req.FinalGoals2
	}
	if len(updates) > 0 {
		if err := a.DB.Model(&database.ImportedMatch{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
	}
	return a.getMatch(c)
}

func (a *API) finishMatch(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	var req finishMatchRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(fiber.StatusBadRequest, "invalid finish payload")
	}

	sheet, err := ensureScoreSheet(a.DB, id)
	if err != nil {
		return err
	}
	if req.Precheck != nil {
		raw, err := jsonString(req.Precheck)
		if err != nil {
			return err
		}
		sheet.PrecheckJSON = raw
	}
	if req.Events != nil {
		raw, err := jsonString(req.Events)
		if err != nil {
			return err
		}
		sheet.EventsJSON = raw
	}
	now := time.Now().UTC()
	sheet.FinalGoals1 = req.FinalGoals1
	sheet.FinalGoals2 = req.FinalGoals2
	sheet.PenaltyGoals1 = req.PenaltyGoals1
	sheet.PenaltyGoals2 = req.PenaltyGoals2
	sheet.KickoffTeam = req.KickoffTeam
	sheet.Comments = req.Comments
	sheet.SubmittedAt = &now
	if err := a.DB.Save(sheet).Error; err != nil {
		return err
	}

	if err := a.DB.Model(&database.ImportedMatch{}).Where("id = ?", id).Updates(map[string]any{
		"status": database.MatchStatusFinished,
		"goals1": req.FinalGoals1,
		"goals2": req.FinalGoals2,
	}).Error; err != nil {
		return err
	}
	return a.getMatch(c)
}

func (a *API) createDocuSealSubmission(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	match, err := a.loadMatch(id)
	if err != nil {
		return err
	}

	client := integration.NewDocuSealClient(a.CFG)
	if !client.Configured() {
		return fail(fiber.StatusServiceUnavailable, "DocuSeal is not configured")
	}

	values := a.docuSealValues(*match)
	req := integration.DocuSealCreateSubmissionRequest{
		TemplateID:           client.TemplateID(),
		SendEmail:            false,
		Order:                "random",
		CompletedRedirectURL: a.CFG.DocuSeal.RedirectURL,
		Variables:            values,
		Submitters: []integration.DocuSealSubmitterRequest{
			{
				Role:                 a.CFG.DocuSeal.Team1Role,
				Name:                 match.Team1Name,
				ExternalID:           fmt.Sprintf("match-%d-team-1", match.ID),
				SendEmail:            false,
				CompletedRedirectURL: a.CFG.DocuSeal.RedirectURL,
				Values:               values,
			},
			{
				Role:                 a.CFG.DocuSeal.Team2Role,
				Name:                 match.Team2Name,
				ExternalID:           fmt.Sprintf("match-%d-team-2", match.ID),
				SendEmail:            false,
				CompletedRedirectURL: a.CFG.DocuSeal.RedirectURL,
				Values:               values,
			},
		},
	}

	submitters, err := client.CreateSubmission(c.Context(), req)
	if err != nil {
		return fail(fiber.StatusBadGateway, err.Error())
	}
	submissionID := integration.SubmissionIDFromSubmitters(submitters)
	submittersJSON, _ := jsonString(submitters)
	links := make(map[string]string, len(submitters))
	for _, submitter := range submitters {
		links[firstNonEmpty(submitter.Role, submitter.Name, submitter.Slug)] = submitter.EmbedSrc
	}
	linksJSON, _ := jsonString(links)

	doc := database.DocuSealSubmission{
		MatchID:          id,
		SubmissionID:     submissionID,
		Status:           "pending",
		SubmittersJSON:   submittersJSON,
		SigningLinksJSON: linksJSON,
	}
	var existing database.DocuSealSubmission
	if err := a.DB.Where("match_id = ?", id).First(&existing).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		if err := a.DB.Create(&doc).Error; err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		existing.SubmissionID = doc.SubmissionID
		existing.Status = doc.Status
		existing.SubmittersJSON = doc.SubmittersJSON
		existing.SigningLinksJSON = doc.SigningLinksJSON
		if err := a.DB.Save(&existing).Error; err != nil {
			return err
		}
	}
	if err := advanceMatchStatus(a.DB, id, database.MatchStatusDocuSealPending); err != nil {
		return err
	}
	return a.getMatch(c)
}

func (a *API) getSigningStatus(c *fiber.Ctx) error {
	id, err := parseUintParam(c, "id")
	if err != nil {
		return err
	}
	doc, err := a.refreshDocuSealForMatch(id)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{
		"docuseal": doc,
	})
}

func (a *API) docuSealWebhook(c *fiber.Ctx) error {
	var payload map[string]any
	if err := c.BodyParser(&payload); err != nil {
		return fail(fiber.StatusBadRequest, "invalid webhook payload")
	}
	raw, _ := jsonString(payload)
	submissionID := extractSubmissionID(payload)
	if submissionID == "" {
		return writeJSON(c, fiber.StatusAccepted, fiber.Map{"ok": true})
	}

	var doc database.DocuSealSubmission
	if err := a.DB.Where("submission_id = ?", submissionID).First(&doc).Error; err != nil {
		return writeJSON(c, fiber.StatusAccepted, fiber.Map{"ok": true})
	}
	doc.LastPayloadJSON = raw
	if status, _ := payload["status"].(string); status != "" {
		doc.Status = status
	}
	if doc.Status == "completed" {
		now := time.Now().UTC()
		doc.CompletedAt = &now
		_ = markMatchSigned(a.DB, doc.MatchID, now)
	}
	if err := a.DB.Save(&doc).Error; err != nil {
		return err
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (a *API) loadMatch(id uint) (*database.ImportedMatch, error) {
	var match database.ImportedMatch
	err := a.DB.
		Preload("ScoreSheet").
		Preload("DocuSeal").
		First(&match, id).Error
	if err != nil {
		return nil, err
	}
	return &match, nil
}

func (a *API) matchesToDTO(matches []database.ImportedMatch) []matchDTO {
	result := make([]matchDTO, 0, len(matches))
	for _, match := range matches {
		result = append(result, a.matchToDTO(match))
	}
	return result
}

func (a *API) matchToDTO(match database.ImportedMatch) matchDTO {
	var settings database.LeagueSetting
	if err := a.DB.Where("league_abbrev = ?", match.LeagueAbbrev).First(&settings).Error; err != nil {
		settings = database.LeagueSetting{
			LeagueAbbrev:    match.LeagueAbbrev,
			LeagueName:      match.LeagueName,
			RobotsPerTeam:   2,
			PeriodSeconds:   600,
			HalfTimeSeconds: 300,
			PenaltySeconds:  60,
			ChecklistSchema: defaultChecklistSchema(),
		}
	}

	return matchDTO{
		ImportedMatch:  match,
		StartAt:        match.StartAt,
		Referees:       jsonValue(match.RefereesJSON, []any{}),
		ScoreSheet:     scoreSheetJSON(match.ScoreSheet),
		DocuSeal:       docuSealJSON(match.DocuSeal),
		LeagueSettings: leagueSettingsJSON(settings),
	}
}

func scoreSheetJSON(sheet database.ScoreSheet) any {
	if sheet.ID == 0 {
		return nil
	}
	return fiber.Map{
		"id":             sheet.ID,
		"precheck":       jsonValue(sheet.PrecheckJSON, fiber.Map{}),
		"events":         jsonValue(sheet.EventsJSON, []any{}),
		"state":          jsonValue(sheet.StateJSON, fiber.Map{}),
		"comments":       sheet.Comments,
		"kickoff_team":   sheet.KickoffTeam,
		"penalty_goals1": sheet.PenaltyGoals1,
		"penalty_goals2": sheet.PenaltyGoals2,
		"final_goals1":   sheet.FinalGoals1,
		"final_goals2":   sheet.FinalGoals2,
		"submitted_at":   sheet.SubmittedAt,
	}
}

func docuSealJSON(doc database.DocuSealSubmission) any {
	if doc.ID == 0 {
		return nil
	}
	return fiber.Map{
		"id":                    doc.ID,
		"submission_id":         doc.SubmissionID,
		"status":                doc.Status,
		"submitters":            jsonValue(doc.SubmittersJSON, []any{}),
		"signing_links":         jsonValue(doc.SigningLinksJSON, fiber.Map{}),
		"audit_log_url":         doc.AuditLogURL,
		"combined_document_url": doc.CombinedDocumentURL,
		"completed_at":          doc.CompletedAt,
	}
}

func leagueSettingsJSON(settings database.LeagueSetting) any {
	return fiber.Map{
		"id":                settings.ID,
		"league_abbrev":     settings.LeagueAbbrev,
		"league_name":       settings.LeagueName,
		"robots_per_team":   settings.RobotsPerTeam,
		"period_seconds":    settings.PeriodSeconds,
		"half_time_seconds": settings.HalfTimeSeconds,
		"penalty_seconds":   settings.PenaltySeconds,
		"checklist_schema":  jsonValue(settings.ChecklistSchema, fiber.Map{}),
	}
}

func (a *API) docuSealValues(match database.ImportedMatch) map[string]any {
	sheet := match.ScoreSheet
	return map[string]any{
		"Match Number":     match.Number,
		"League":           firstNonEmpty(match.LeagueName, match.LeagueAbbrev),
		"Stage":            match.StageName,
		"Field":            match.FieldName,
		"Team 1":           match.Team1Name,
		"Team 2":           match.Team2Name,
		"Kick-Off":         sheet.KickoffTeam,
		"Penalty Goals 1":  sheet.PenaltyGoals1,
		"Penalty Goals 2":  sheet.PenaltyGoals2,
		"Goals 1":          sheet.FinalGoals1,
		"Goals 2":          sheet.FinalGoals2,
		"Final Score":      fmt.Sprintf("%d:%d", sheet.FinalGoals1, sheet.FinalGoals2),
		"Comments":         sheet.Comments,
		"Precheck JSON":    sheet.PrecheckJSON,
		"Events JSON":      sheet.EventsJSON,
		"Submitted At UTC": time.Now().UTC().Format(time.RFC3339),
	}
}

func (a *API) refreshDocuSealForMatch(matchID uint) (*database.DocuSealSubmission, error) {
	var doc database.DocuSealSubmission
	if err := a.DB.Where("match_id = ?", matchID).First(&doc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fail(fiber.StatusNotFound, "DocuSeal submission not found")
		}
		return nil, err
	}
	if doc.SubmissionID == "" {
		return &doc, nil
	}
	client := integration.NewDocuSealClient(a.CFG)
	if !client.Configured() {
		return &doc, nil
	}
	submission, err := client.GetSubmission(context.Background(), doc.SubmissionID)
	if err != nil {
		return nil, fail(fiber.StatusBadGateway, err.Error())
	}
	if err := a.applyDocuSealSubmission(&doc, submission); err != nil {
		return nil, err
	}
	return &doc, nil
}

func (a *API) applyDocuSealSubmission(doc *database.DocuSealSubmission, submission *integration.DocuSealSubmission) error {
	doc.Status = firstNonEmpty(submission.Status, doc.Status)
	doc.AuditLogURL = submission.AuditLogURL
	doc.CombinedDocumentURL = submission.CombinedDocumentURL
	doc.CompletedAt = submission.CompletedAt
	submittersJSON, _ := jsonString(submission.Submitters)
	doc.SubmittersJSON = submittersJSON
	links := make(map[string]string, len(submission.Submitters))
	for _, submitter := range submission.Submitters {
		links[firstNonEmpty(submitter.Role, submitter.Name, submitter.Slug)] = submitter.EmbedSrc
	}
	linksJSON, _ := jsonString(links)
	doc.SigningLinksJSON = linksJSON
	rawJSON, _ := jsonString(submission.Raw)
	doc.LastPayloadJSON = rawJSON

	if doc.Status == "completed" || allSubmittersCompleted(submission.Submitters) {
		now := time.Now().UTC()
		if doc.CompletedAt == nil {
			doc.CompletedAt = &now
		}
		if err := markMatchSigned(a.DB, doc.MatchID, *doc.CompletedAt); err != nil {
			return err
		}
	}
	return a.DB.Save(doc).Error
}

func allSubmittersCompleted(submitters []integration.DocuSealSubmitter) bool {
	if len(submitters) == 0 {
		return false
	}
	for _, submitter := range submitters {
		if submitter.Status != "completed" && submitter.CompletedAt == nil {
			return false
		}
	}
	return true
}

func markMatchSigned(db *gorm.DB, matchID uint, at time.Time) error {
	return db.Model(&database.ImportedMatch{}).Where("id = ?", matchID).Updates(map[string]any{
		"status":    database.MatchStatusSigned,
		"signed_at": at,
	}).Error
}

func extractSubmissionID(payload map[string]any) string {
	candidates := []any{
		payload["submission_id"],
		payload["id"],
	}
	if nested, _ := payload["submission"].(map[string]any); nested != nil {
		candidates = append(candidates, nested["id"], nested["submission_id"])
	}
	if nested, _ := payload["data"].(map[string]any); nested != nil {
		candidates = append(candidates, nested["id"], nested["submission_id"])
	}
	for _, candidate := range candidates {
		switch value := candidate.(type) {
		case string:
			return value
		case float64:
			return strconv.Itoa(int(value))
		}
	}
	return ""
}

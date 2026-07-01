package web

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"RCJV-Paperless/internal/database"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

func parseUintParam(c *fiber.Ctx, name string) (uint, error) {
	raw := c.Params(name)
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return 0, fiber.NewError(fiber.StatusBadRequest, "invalid "+name)
	}
	return uint(id), nil
}

func writeJSON(c *fiber.Ctx, status int, value any) error {
	return c.Status(status).JSON(value)
}

func fail(status int, message string) error {
	return fiber.NewError(status, message)
}

func jsonString(value any) (string, error) {
	bytes, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func jsonValue(raw string, fallback any) any {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return fallback
	}
	return value
}

func defaultChecklistSchema() string {
	schema := map[string]any{
		"robot_checks": []map[string]any{
			{"key": "weight", "label": "Weight", "type": "text", "hint": "max. 1100 / 1400 / 2200 g"},
			{"key": "dimensions", "label": "Dimensions", "type": "boolean"},
			{"key": "ball_capture_zone", "label": "Ball Capt. Zone", "type": "boolean"},
			{"key": "kicker", "label": "Kicker", "type": "boolean"},
			{"key": "voltage", "label": "Voltage", "type": "boolean"},
		},
		"team_fields": []map[string]any{
			{"key": "kickoff", "label": "Kick-Off", "type": "select", "options": []string{"team1", "team2"}},
			{"key": "penalty_goals", "label": "Penalty Goals", "type": "number"},
			{"key": "goals", "label": "Goals", "type": "number"},
			{"key": "final_score", "label": "Final Score", "type": "score"},
		},
		"comments": true,
	}
	raw, _ := jsonString(schema)
	return raw
}

func ensureScoreSheet(db *gorm.DB, matchID uint) (*database.ScoreSheet, error) {
	var sheet database.ScoreSheet
	err := db.Where("match_id = ?", matchID).First(&sheet).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		sheet = database.ScoreSheet{
			MatchID:    matchID,
			EventsJSON: "[]",
		}
		if err := db.Create(&sheet).Error; err != nil {
			return nil, err
		}
		return &sheet, nil
	}
	if err != nil {
		return nil, err
	}
	return &sheet, nil
}

func advanceMatchStatus(db *gorm.DB, matchID uint, status string) error {
	terminal := map[string]bool{
		database.MatchStatusSigned:          true,
		database.MatchStatusEnteredCatigoal: true,
		database.MatchStatusCancelled:       true,
	}

	var match database.ImportedMatch
	if err := db.Select("id", "status").First(&match, matchID).Error; err != nil {
		return err
	}
	if terminal[match.Status] && match.Status != status {
		return nil
	}
	return db.Model(&database.ImportedMatch{}).Where("id = ?", matchID).Update("status", status).Error
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func parseCatigoalTime(raw string) *time.Time {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return &parsed
		}
	}
	return nil
}

func parseDurationSeconds(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		return seconds
	}
	if duration, err := time.ParseDuration(raw); err == nil {
		return int(duration.Seconds())
	}
	return 0
}

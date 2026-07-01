package database

import "gorm.io/gorm"

func InitDatabase(db *gorm.DB) error {
	return db.AutoMigrate(
		&Field{},
		&LeagueSetting{},
		&ImportedMatch{},
		&ScoreSheet{},
		&DocuSealSubmission{},
	)
}

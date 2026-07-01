package main

import (
	"RCJV-Paperless/internal/config"
	"RCJV-Paperless/internal/database"
	"RCJV-Paperless/internal/web"
	"log"
	"os"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.SetOutput(os.Stdout)

	var cfg = config.GetConfig()

	db, err := database.GetPSQL(cfg)
	if err != nil {
		log.Fatal(err)
	}
	if err := database.InitDatabase(db); err != nil {
		log.Fatal(err)
	}

	web.InitWeb(cfg, db)
}

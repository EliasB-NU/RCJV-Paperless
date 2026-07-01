package web

import (
	"RCJV-Paperless/internal/config"
	"crypto/rsa"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/healthcheck"
	"github.com/gofiber/websocket/v2"
	"gorm.io/gorm"
)

type API struct {
	DB          *gorm.DB
	CFG         *config.Config
	Clients     map[*websocket.Conn]bool
	jwksMu      sync.Mutex
	jwksKeys    map[string]*rsa.PublicKey
	jwksFetched time.Time
}

func InitWeb(cfg *config.Config, db *gorm.DB) {
	var (
		addr = fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

		err error

		fiberApp = fiber.New(fiber.Config{
			ServerHeader: "rcjv_paperless:fiber",
			AppName:      "rcjv_paperless",
		})

		c = cors.New(cors.Config{
			AllowOrigins: strings.Join([]string{
				"https://tas.technulgy.com",
				"http://localhost:3001",
				"https://links.technulgy.com",
				"http://localhost:3002",
				"https://technulgy.com",
				"http://localhost:5173",
			}, ","),

			AllowMethods: strings.Join([]string{
				fiber.MethodGet,
				fiber.MethodPost,
				fiber.MethodPatch,
				fiber.MethodDelete,
				fiber.MethodOptions,
			}, ","),

			AllowHeaders: strings.Join([]string{
				"Content-Type",
				"Accept",
				"Origin",
				"Authorization",
			}, ","),

			AllowCredentials: true,
			MaxAge:           86400,
		})
	)
	// Internal
	fiberApp.Use(c) // Cors Middleware
	fiberApp.Use(healthcheck.New(healthcheck.ConfigDefault))

	// API
	api := fiber.New()
	fiberApp.Mount("/api", api)
	a := API{
		DB:      db,
		CFG:     cfg,
		Clients: make(map[*websocket.Conn]bool),
	}
	// API
	api.Get("/healthcheck", a.getHealthcheck)
	api.Get("/auth/config", a.authConfig)

	api.Get("/fields", a.listFields)
	api.Get("/tablet/matches", a.listTabletMatches)
	api.Get("/matches/:id", a.getMatch)
	api.Post("/matches/:id/precheck", a.savePrecheck)
	api.Post("/matches/:id/events", a.recordMatchEvent)
	api.Post("/matches/:id/finish", a.finishMatch)
	api.Post("/matches/:id/docuseal", a.createDocuSealSubmission)
	api.Get("/matches/:id/signing-status", a.getSigningStatus)
	api.Post("/webhooks/docuseal", a.docuSealWebhook)

	admin := api.Group("/admin", a.requireAdmin)
	admin.Post("/sync/catigoal", a.syncCatigoal)
	admin.Get("/matches", a.listAdminMatches)
	admin.Patch("/matches/:id/status", a.updateMatchStatus)
	admin.Get("/leagues", a.listLeagues)
	admin.Patch("/leagues/:id/settings", a.updateLeagueSettings)
	admin.Get("/docuseal/submissions/:id", a.getDocuSealSubmission)
	admin.Post("/docuseal/submissions/:id/refresh", a.refreshDocuSealSubmission)

	// Static
	fiberApp.Static("/", "./frontend/dist")
	fiberApp.Get("*", func(c *fiber.Ctx) error {
		return c.SendFile("./frontend/dist/index.html")
	})

	log.Println("Starting RCJV Paperless")
	err = fiberApp.Listen(addr)
	if err != nil {
		log.Fatal(err)
	}
}

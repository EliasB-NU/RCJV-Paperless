# RCJV Paperless

RCJV Paperless replaces printed RoboCup Junior Soccer referee sheets with a web
interface for field referees and an admin area for event staff.

The application imports matches from Catigoal, stores match progress in
PostgreSQL, controls optional robot communication modules through Web Bluetooth,
and can send completed score sheets to DocuSeal for team signatures.

## Features

- Field console for referees
- Admin panel for Catigoal sync and league configuration
- PostgreSQL-backed match, score sheet, and signature state
- Automatic GORM database migrations on startup
- FusionAuth login support for public deployments
- Optional Web Bluetooth robot control
- Per-robot penalty countdowns for robots without communication modules
- DocuSeal submission creation and signing status refresh

## Requirements

- Go 1.25 or newer
- Node.js and npm
- PostgreSQL
- FusionAuth, for production authentication
- DocuSeal, if signature collection is required

## Setup

Clone the repository and install frontend dependencies:

```bash
npm --prefix frontend ci
```

Create your local config file:

```bash
cp config.example.toml config.toml
```

Edit `config.toml` for your environment.

## Configuration

### Database

Only PostgreSQL is supported.

```toml
[database]
host = "localhost"
port = 5432
user = "rcjv_paperless"
pass = "password"
database = "rcjv_paperless"
timezone = "Europe/Berlin"
```

The application runs database migrations automatically at startup using GORM
`AutoMigrate`. The database itself and database user must already exist.

### Server

```toml
[server]
host = "0.0.0.0"
port = 8000
```

For local-only testing, use `host = "127.0.0.1"`.

### Catigoal

```toml
[catigoal]
base_url = "https://example.invalid/api/"
```

The admin panel can sync matches from this Catigoal API. Matches are also synced
in the background while the admin page is open.

### DocuSeal

```toml
[docuseal]
base_url = "https://api.docuseal.com"
api_key = ""
template_id = 0
team1_role = "Team 1"
team2_role = "Team 2"
completed_redirect_url = ""
```

Use `https://api.docuseal.eu` if your DocuSeal account is hosted in the EU.

The role names must match the roles in the DocuSeal template.

### FusionAuth

```toml
[auth]
issuer = "https://auth.example.org"
client_id = ""
required_role = "admin"
dev_allow_admin = false
```

`dev_allow_admin = true` disables login checks for both the referee and admin
APIs. Keep it `false` for any public deployment.

Configure your FusionAuth application with this redirect URI:

```text
https://your-domain/admin/callback
```

Referees need a valid token for the configured FusionAuth application. Admin
users additionally need the role configured in `required_role`.

## Running Locally

Build the frontend:

```bash
npm --prefix frontend run build
```

Start the Go server:

```bash
go run ./cmd/rcjv_paperless
```

Open:

```text
http://localhost:8000/
http://localhost:8000/admin
```

For frontend-only development, run Vite:

```bash
npm --prefix frontend run dev
```

The production Go server serves files from `frontend/dist`, so run the frontend
build before starting the server for normal use.

## Event Workflow

1. Open `/admin`.
2. Sync Catigoal matches.
3. Configure each league:
   - robots per team
   - period duration
   - half-time duration
   - penalty timeout duration
   - pre-match checklist schema
4. Referees open `/`, select their field, and choose a match.
5. Referees complete pre-match checks.
6. During the match, referees manage:
   - match clock
   - score
   - comments
   - robot Bluetooth control
   - per-robot penalty timers
7. Referees submit the match.
8. DocuSeal links are generated for team signatures.
9. Admin marks signed matches as entered in Catigoal.

## Data Persistence

Match progress is saved to PostgreSQL. A page refresh should restore the current
match score, comments, clock state, stage, and active robot penalty timers.

The frontend also stores the selected field and login token in browser storage.

## Verification

Run backend checks:

```bash
go test ./...
```

Run frontend checks and build:

```bash
npm --prefix frontend run build
```

## Troubleshooting

### Login is not required

Check `config.toml`. If `dev_allow_admin = true`, authentication is bypassed.
Set it to `false` for production.

### Database migration fails

Confirm that PostgreSQL is reachable and that the configured user can create and
alter tables in the configured database.

### No matches are visible

Check that:

- Catigoal `base_url` is configured
- the admin sync succeeds
- matches have a field assigned
- the referee selected the correct field
- the match is not already signed, entered, or cancelled

### Web Bluetooth is unavailable

Web Bluetooth requires browser support and usually HTTPS. Localhost is allowed by
most supported browsers for development.

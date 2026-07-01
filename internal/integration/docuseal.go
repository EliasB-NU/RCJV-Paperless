package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"RCJV-Paperless/internal/config"
)

type DocuSealClient struct {
	baseURL    string
	apiKey     string
	templateID int
	httpClient *http.Client
}

type DocuSealSubmitterRequest struct {
	Role                 string         `json:"role"`
	Name                 string         `json:"name,omitempty"`
	Email                string         `json:"email,omitempty"`
	ExternalID           string         `json:"external_id,omitempty"`
	SendEmail            bool           `json:"send_email"`
	CompletedRedirectURL string         `json:"completed_redirect_url,omitempty"`
	Values               map[string]any `json:"values,omitempty"`
}

type DocuSealCreateSubmissionRequest struct {
	TemplateID           int                        `json:"template_id"`
	SendEmail            bool                       `json:"send_email"`
	Order                string                     `json:"order,omitempty"`
	CompletedRedirectURL string                     `json:"completed_redirect_url,omitempty"`
	Variables            map[string]any             `json:"variables,omitempty"`
	Submitters           []DocuSealSubmitterRequest `json:"submitters"`
}

type DocuSealSubmitter struct {
	ID           int             `json:"id"`
	SubmissionID int             `json:"submission_id"`
	UUID         string          `json:"uuid"`
	Email        string          `json:"email"`
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	Role         string          `json:"role"`
	Status       string          `json:"status"`
	EmbedSrc     string          `json:"embed_src"`
	CompletedAt  *time.Time      `json:"completed_at"`
	Metadata     json.RawMessage `json:"metadata"`
}

type DocuSealDocument struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type DocuSealSubmission struct {
	ID                  int                 `json:"id"`
	Slug                string              `json:"slug"`
	Status              string              `json:"status"`
	AuditLogURL         string              `json:"audit_log_url"`
	CombinedDocumentURL string              `json:"combined_document_url"`
	CompletedAt         *time.Time          `json:"completed_at"`
	Submitters          []DocuSealSubmitter `json:"submitters"`
	Documents           []DocuSealDocument  `json:"documents"`
	Raw                 map[string]any      `json:"-"`
}

func NewDocuSealClient(cfg *config.Config) *DocuSealClient {
	return &DocuSealClient{
		baseURL:    cfg.DocuSeal.BaseURL,
		apiKey:     cfg.DocuSeal.APIKey,
		templateID: cfg.DocuSeal.TemplateID,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *DocuSealClient) Configured() bool {
	return c != nil && c.baseURL != "" && c.apiKey != "" && c.templateID > 0
}

func (c *DocuSealClient) TemplateID() int {
	return c.templateID
}

func (c *DocuSealClient) CreateSubmission(ctx context.Context, req DocuSealCreateSubmissionRequest) ([]DocuSealSubmitter, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("docuseal is not configured")
	}
	if req.TemplateID == 0 {
		req.TemplateID = c.templateID
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/submissions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	c.decorate(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("docuseal create submission failed: status %d: %s", resp.StatusCode, string(respBody))
	}

	var submitters []DocuSealSubmitter
	if err := json.Unmarshal(respBody, &submitters); err != nil {
		return nil, err
	}
	return submitters, nil
}

func (c *DocuSealClient) GetSubmission(ctx context.Context, submissionID string) (*DocuSealSubmission, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("docuseal is not configured")
	}
	if submissionID == "" {
		return nil, fmt.Errorf("submission id is required")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/submissions/"+submissionID, nil)
	if err != nil {
		return nil, err
	}
	c.decorate(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("docuseal get submission failed: status %d: %s", resp.StatusCode, string(respBody))
	}

	var raw map[string]any
	if err := json.Unmarshal(respBody, &raw); err != nil {
		return nil, err
	}
	var submission DocuSealSubmission
	if err := json.Unmarshal(respBody, &submission); err != nil {
		return nil, err
	}
	submission.Raw = raw
	return &submission, nil
}

func (c *DocuSealClient) decorate(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Auth-Token", c.apiKey)
}

func SubmissionIDFromSubmitters(submitters []DocuSealSubmitter) string {
	for _, submitter := range submitters {
		if submitter.SubmissionID > 0 {
			return strconv.Itoa(submitter.SubmissionID)
		}
	}
	return ""
}

package health

type CheckResult struct {
	Name     string
	OK       bool
	Severity string
	Message  string
	Err      error
}

const (
	SeverityCritical = "critical"
	SeverityWarning  = "warning"
)

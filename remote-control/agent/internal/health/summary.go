package health

type Summary struct {
	Passed   bool
	Failed   []CheckResult
	Warnings []CheckResult
	Results  []CheckResult
}

func (s Summary) Fatal() bool {
	for _, result := range s.Failed {
		if result.Severity == SeverityCritical {
			return true
		}
	}
	return false
}

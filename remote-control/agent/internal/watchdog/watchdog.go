package watchdog

func NewDefaultMonitor() *Monitor {
	return NewMonitor(DefaultThresholds())
}

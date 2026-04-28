package main

import agentlogging "remote-control-agent/internal/logging"

var rootLogger *agentlogging.Logger

func logger(component string) *agentlogging.Logger {
	if rootLogger == nil {
		return nil
	}
	return rootLogger.WithComponent(component)
}

func logMetadata(values ...any) map[string]any {
	if len(values) == 0 {
		return nil
	}

	metadata := map[string]any{}
	for i := 0; i+1 < len(values); i += 2 {
		key, ok := values[i].(string)
		if !ok || key == "" {
			continue
		}
		metadata[key] = values[i+1]
	}
	if len(metadata) == 0 {
		return nil
	}
	return metadata
}

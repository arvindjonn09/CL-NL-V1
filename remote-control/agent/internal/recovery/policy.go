package recovery

import "time"

func HeartbeatPolicy() Policy {
	return Policy{
		MaxAttempts:   3,
		InitialDelay:  500 * time.Millisecond,
		MaxDelay:      5 * time.Second,
		JitterPercent: 0.20,
	}
}

func BackendPollPolicy() Policy {
	return Policy{
		MaxAttempts:   2,
		InitialDelay:  400 * time.Millisecond,
		MaxDelay:      3 * time.Second,
		JitterPercent: 0.20,
	}
}

func StatusUploadPolicy() Policy {
	return Policy{
		MaxAttempts:   3,
		InitialDelay:  500 * time.Millisecond,
		MaxDelay:      6 * time.Second,
		JitterPercent: 0.20,
	}
}

func FileTransferPolicy() Policy {
	return Policy{
		MaxAttempts:   3,
		InitialDelay:  1 * time.Second,
		MaxDelay:      10 * time.Second,
		JitterPercent: 0.20,
	}
}

func DiagnosticsUploadPolicy() Policy {
	return Policy{
		MaxAttempts:   2,
		InitialDelay:  750 * time.Millisecond,
		MaxDelay:      5 * time.Second,
		JitterPercent: 0.20,
	}
}

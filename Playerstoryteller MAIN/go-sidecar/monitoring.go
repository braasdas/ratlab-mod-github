package main

import (
	"context"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

// ParentMonitor monitors the parent process and exits when it dies
type ParentMonitor struct {
	pid    uint32
	logger *Logger
	cancel context.CancelFunc
}

// NewParentMonitor creates a new parent process monitor
func NewParentMonitor(pid uint32, logger *Logger, cancel context.CancelFunc) *ParentMonitor {
	return &ParentMonitor{
		pid:    pid,
		logger: logger,
		cancel: cancel,
	}
}

// Start begins monitoring the parent process
func (m *ParentMonitor) Start(ctx context.Context) {
	if m.pid == 0 {
		m.logger.Info("Parent PID is 0, not monitoring parent process")
		return
	}

	m.logger.Info("Started monitoring parent process with PID %d", m.pid)

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				m.logger.Info("Parent monitor stopped")
				return

			case <-ticker.C:
				if !m.isProcessAlive() {
					m.logger.Info("Parent process (PID %d) has exited. Terminating sidecar.", m.pid)
					m.cancel()
					os.Exit(0)
				}
			}
		}
	}()
}

// isProcessAlive checks if the process is still running
func (m *ParentMonitor) isProcessAlive() bool {
	// Attempt to open the process to get a handle
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION, false, m.pid)
	if err != nil {
		// Process doesn't exist or access denied
		return false
	}
	defer windows.CloseHandle(handle)

	// Query the exit code
	var exitCode uint32
	err = windows.GetExitCodeProcess(handle, &exitCode)
	if err != nil {
		m.logger.Error("Failed to get exit code for parent process (PID %d): %v", m.pid, err)
		return false
	}

	// STILL_ACTIVE (259) means the process is still running
	return exitCode == STILL_ACTIVE
}

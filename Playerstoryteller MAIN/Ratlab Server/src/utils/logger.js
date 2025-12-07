// LOGGING: Helper function for consistent logging with timestamps
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (level === 'error') {
        console.error(logMessage, data ? data : '');
    } else if (level === 'warn') {
        console.warn(logMessage, data ? data : '');
    } else {
        console.log(logMessage, data ? data : '');
    }
}

module.exports = log;

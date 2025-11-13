class Logger {
    constructor(debugMode = false, timestamps = true) {
        this.debugMode = debugMode;
        this.timestamps = timestamps;
    }

    formatMessage(msg, level) {
        const timestamp = this.timestamps ? `${new Date().toISOString()} ` : '';
        const levelFormatted = `[${level}]`.padEnd(7);
        return `${timestamp}${levelFormatted} ${msg}`;
    }

    info(msg) {
        console.log(this.formatMessage(msg, 'INFO'));
    }

    warn(msg) {
        console.warn(this.formatMessage(msg, 'WARN'));
    }

    error(msg) {
        console.error(this.formatMessage(msg, 'ERROR'));
    }

    debug(msg) {
        if (this.debugMode) {
            console.debug(this.formatMessage(msg, 'DEBUG'));
        }
    }
}

module.exports = Logger;
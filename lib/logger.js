const ora = require('ora');

class Logger {
    constructor(debugMode = false, timestamps = true) {
        this.debugMode = debugMode;
        this.timestamps = timestamps;
    }

    formatPrefix(level) {
        const timestamp = this.timestamps ? `${new Date().toISOString()} ` : '';
        const levelFormatted = `[${level}]`.padEnd(7);
        return timestamp + levelFormatted;
    }

    formatMessage(msg, level) {
        return `${this.formatPrefix(level)} ${msg}`;
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

    loading(msg) {
        const spinner = ora({
            prefixText: this.formatPrefix('INFO'),
            text: msg,
            spinner: 'dots'
        }).start();
        return spinner;
    }
}

module.exports = Logger;
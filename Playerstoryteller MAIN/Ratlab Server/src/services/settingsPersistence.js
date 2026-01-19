const fs = require('fs').promises;
const path = require('path');
const log = require('../utils/logger');

const SETTINGS_DIR = path.join(__dirname, '../../data/settings');

class SettingsPersistence {
    constructor() {
        this.ensureSettingsDir();
    }

    async ensureSettingsDir() {
        try {
            await fs.mkdir(SETTINGS_DIR, { recursive: true });
        } catch (error) {
            log('error', 'Failed to create settings directory:', error);
        }
    }

    getSettingsPath(streamKey) {
        // Use stream key as filename (sanitized)
        const sanitized = streamKey.replace(/[^a-zA-Z0-9-_]/g, '_');
        return path.join(SETTINGS_DIR, `${sanitized}.json`);
    }

    async saveSettings(streamKey, settings) {
        try {
            const filePath = this.getSettingsPath(streamKey);
            const data = {
                settings: settings.settings || {},
                economy: settings.economy || {},
                meta: settings.meta || {},
                queueSettings: settings.queueSettings || {},
                lastUpdated: new Date().toISOString()
            };

            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            log('info', `Settings saved for stream key: ${streamKey.substring(0, 8)}...`);
            return true;
        } catch (error) {
            log('error', `Failed to save settings for ${streamKey}:`, error);
            return false;
        }
    }

    async loadSettings(streamKey) {
        try {
            const filePath = this.getSettingsPath(streamKey);
            const data = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(data);
            log('info', `Settings loaded for stream key: ${streamKey.substring(0, 8)}...`);
            return parsed;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                log('error', `Failed to load settings for ${streamKey}:`, error);
            }
            return null;
        }
    }

    async deleteSettings(streamKey) {
        try {
            const filePath = this.getSettingsPath(streamKey);
            await fs.unlink(filePath);
            log('info', `Settings deleted for stream key: ${streamKey.substring(0, 8)}...`);
            return true;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                log('error', `Failed to delete settings for ${streamKey}:`, error);
            }
            return false;
        }
    }
}

module.exports = new SettingsPersistence();

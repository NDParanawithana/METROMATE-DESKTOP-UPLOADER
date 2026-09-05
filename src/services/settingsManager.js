const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * SettingsManager
 * Handles persistent configuration for the Desktop Stem Uploader application,
 * specifically the stem watch folder and watcher preferences.
 */
class SettingsManager {
  /**
   * @param {import('electron').App} app - Electron App instance
   */
  constructor(app) {
    this.app = app;
    this.settingsFilePath = path.join(this.app.getPath('userData'), 'watcher-settings.json');
    this.settings = {
      watchFolder: '',
      isPaused: false,
    };
    this.loadSettings();
  }

  /**
   * Get dynamic default Music/Collaboration Stems folder for current OS user
   * @returns {string}
   */
  getDefaultWatchFolder() {
    let musicPath = '';
    try {
      musicPath = this.app.getPath('music');
    } catch (_) {
      musicPath = '';
    }

    if (!musicPath || !fs.existsSync(musicPath)) {
      musicPath = path.join(os.homedir(), 'Music');
    }

    return path.join(musicPath, 'Collaboration Stems');
  }

  /**
   * Load settings from persistent disk file
   * @returns {object}
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.settings = {
          ...this.settings,
          ...parsed,
        };
      }
    } catch (err) {
      console.warn('[SettingsManager] Failed to read settings file, using defaults:', err.message);
    }

    // If watch folder is empty, initialize with default
    if (!this.settings.watchFolder) {
      this.settings.watchFolder = this.getDefaultWatchFolder();
    }

    return this.settings;
  }

  /**
   * Save partial or complete settings to disk
   * @param {object} newSettings
   * @returns {object}
   */
  saveSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings,
    };

    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err) {
      console.error('[SettingsManager] Failed to save settings to disk:', err.message);
    }

    return this.settings;
  }

  /**
   * Get current in-memory settings
   * @returns {object}
   */
  getSettings() {
    return { ...this.settings };
  }
}

module.exports = SettingsManager;

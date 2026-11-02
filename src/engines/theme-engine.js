const fs = require('fs');
const path = require('path');

/** Load external theme definitions independently of application behavior. */
class ThemeEngine {
  constructor(baseDir) {
    this.themesDir = path.join(baseDir, 'themes');
    this.activeConfigPath = path.join(this.themesDir, 'active-theme.json');
  }

  getActiveThemeState() {
    try {
      const configRaw = fs.readFileSync(this.activeConfigPath, 'utf8');
      const config = JSON.parse(configRaw);
      const themeId = config.activeTheme || 'emerald-sanctuary';
      const mode = config.activeMode || 'dark';
      const themeData = this.loadThemeById(themeId);

      // Discover JSON themes added to the themes directory.
      const discoveredThemes = this.discoverAllThemes();

      return {
        activeTheme: themeId,
        activeMode: mode,
        availableThemes: discoveredThemes,
        themeData,
        cssVariables: this.compileCssVariables(themeData, mode),
      };
    } catch (err) {
      console.error('[ThemeEngine] Failed to load active theme state:', err.message);
      return null;
    }
  }

  discoverAllThemes() {
    try {
      const files = fs
        .readdirSync(this.themesDir)
        .filter((file) => file.endsWith('.json') && file !== 'active-theme.json');
      return files.map((file) => {
        const fullPath = path.join(this.themesDir, file);
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        return {
          id: content.id || path.basename(file, '.json'),
          name: content.name || path.basename(file, '.json'),
          author: content.author || 'User Custom',
          fileName: file,
        };
      });
    } catch (err) {
      console.error('[ThemeEngine] Error discovering themes:', err.message);
      return [];
    }
  }

  loadThemeById(themeId) {
    const targetPath = path.join(this.themesDir, `${themeId}.json`);
    if (fs.existsSync(targetPath)) {
      return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    }
    const fallbackPath = path.join(this.themesDir, 'emerald-sanctuary.json');
    return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  }

  compileCssVariables(themeData, mode = 'dark') {
    if (!themeData) return {};
    const selectedModeVars =
      (themeData.modes && (themeData.modes[mode] || themeData.modes.dark)) || {};
    return {
      ...(themeData.typography || {}),
      ...(themeData.layout || {}),
      ...selectedModeVars,
    };
  }

  setTheme(themeId, mode) {
    try {
      let current = { activeTheme: 'emerald-sanctuary', activeMode: 'dark' };
      if (fs.existsSync(this.activeConfigPath)) {
        current = JSON.parse(fs.readFileSync(this.activeConfigPath, 'utf8'));
      }
      if (themeId) current.activeTheme = themeId;
      if (mode) current.activeMode = mode;
      fs.writeFileSync(this.activeConfigPath, JSON.stringify(current, null, 2), 'utf8');
      return this.getActiveThemeState();
    } catch (err) {
      console.error('[ThemeEngine] Error saving active theme:', err.message);
      return this.getActiveThemeState();
    }
  }
}

module.exports = ThemeEngine;

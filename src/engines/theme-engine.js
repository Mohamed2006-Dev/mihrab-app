const fs = require('fs');
const path = require('path');

/** Load external theme definitions independently of application behavior. */
class ThemeEngine {
  constructor(baseDir, writableDir = baseDir) {
    this.themesDir = path.join(baseDir, 'themes');
    this.activeConfigPath = path.join(writableDir, 'themes', 'active-theme.json');
  }

  getActiveThemeState() {
    let config = { activeTheme: 'emerald-sanctuary', activeMode: 'dark' };
    if (fs.existsSync(this.activeConfigPath)) {
      try {
        config = { ...config, ...JSON.parse(fs.readFileSync(this.activeConfigPath, 'utf8')) };
      } catch (error) {
        console.warn('[ThemeEngine] Invalid local preferences; using defaults:', error.message);
      }
    }
    const themeId = config.activeTheme || 'emerald-sanctuary';
    const mode = config.activeMode === 'light' ? 'light' : 'dark';
    const themeData = this.loadThemeById(themeId);
    return {
      activeTheme: themeData.id || themeId,
      activeMode: mode,
      availableThemes: this.discoverAllThemes(),
      themeData,
      cssVariables: this.compileCssVariables(themeData, mode),
    };
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
          family: content.family === 'classic' ? 'classic' : 'modern',
          preview: { light: this.compileCssVariables(content, 'light'), dark: this.compileCssVariables(content, 'dark') },
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
      fs.mkdirSync(path.dirname(this.activeConfigPath), { recursive: true });
      fs.writeFileSync(this.activeConfigPath, JSON.stringify(current, null, 2), 'utf8');
      return this.getActiveThemeState();
    } catch (err) {
      console.error('[ThemeEngine] Error saving active theme:', err.message);
      return this.getActiveThemeState();
    }
  }
}

module.exports = ThemeEngine;

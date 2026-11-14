const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = function checkBuildLocales() {
  const root = path.resolve(__dirname, '..');
  try {
    execFileSync(process.env.PYTHON || 'python', ['scripts/sync-locales.py', 'check'], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error('[Mihrab locales] Desktop build stopped. See locale check output above. '
      + (error.code === 'ENOENT' ? 'Python executable was not found.' : ''), { cause: error });
  }
  return true;
};

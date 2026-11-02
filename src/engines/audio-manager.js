const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

class WindowsAudioBackend {
  constructor() {
    this.scriptPath = path.join(__dirname, '..', 'native', 'windows-audio.ps1');
  }

  run(action, state = null) {
    const payload = Buffer.from(JSON.stringify(state || {}), 'utf8').toString('base64');
    // Send the script over stdin: this also works when the source is inside app.asar.
    // Only a fixed action and base64 JSON enter the PowerShell command line.
    const command = `$script = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($script)) -Action '${action}' -State '${payload}'`;
    return new Promise((resolve, reject) => {
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
        { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) return reject(new Error(`Windows audio: ${stderr.trim() || error.message}`));
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error('Windows audio returned an invalid response.'));
          }
        },
      );
      child.stdin.on('error', () => {}); // Spawn failures are reported by the callback.
      child.stdin.end(fs.readFileSync(this.scriptPath, 'utf8'));
    });
  }

  getState() {
    return this.run('read');
  }
  mute(state) {
    return this.run('mute', state);
  }
  restore(state) {
    return this.run('restore', state);
  }
}

class AudioManager {
  constructor({ backend = new WindowsAudioBackend(), platform = process.platform } = {}) {
    this.backend = backend;
    this.platform = platform;
    this.previousState = null;
    this.pendingMutes = 0;
    this.queue = Promise.resolve();
  }

  get needsRestore() {
    return this.previousState !== null || this.pendingMutes > 0;
  }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  muteForLock() {
    if (this.platform !== 'win32') return Promise.resolve();
    this.pendingMutes++;
    return this.enqueue(async () => {
      try {
        if (this.previousState) return;
        const state = await this.backend.getState();
        if (
          !state ||
          typeof state.deviceId !== 'string' ||
          !state.deviceId ||
          typeof state.volume !== 'number' ||
          !Number.isFinite(state.volume) ||
          state.volume < 0 ||
          state.volume > 1 ||
          typeof state.muted !== 'boolean'
        ) {
          throw new Error('Cannot mute without a valid original audio state.');
        }
        // Save before making any changes, including changes that might partially fail.
        this.previousState = Object.freeze({ ...state });
        await this.backend.mute(this.previousState);
      } finally {
        this.pendingMutes--;
      }
    });
  }

  restore() {
    return this.enqueue(async () => {
      if (!this.previousState) return;
      await this.backend.restore(this.previousState);
      this.previousState = null; // Retain the snapshot if restoration fails, allowing a retry.
    });
  }
}

module.exports = { AudioManager, WindowsAudioBackend };

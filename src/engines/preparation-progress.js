'use strict';

const fs = require('node:fs');
const path = require('node:path');

const idleAfterSeconds = 60;
const transitionSeconds = 15;
const maximumStoredPrayers = 20;

function localDay(now) {
  const date = new Date(now);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

class PreparationProgress {
  constructor(file) {
    this.file = file;
    this.state = { streak: 0, bypassDay: 0, prayers: {} };
    try {
      this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') this.readError = error;
    }
  }

  commit(patch) {
    if (this.readError) throw this.readError;
    const next = { ...this.state, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(next), { flush: true });
    fs.renameSync(temporary, this.file);
    this.state = next;
  }

  record(prayer, change, patch = {}) {
    const prayers = { ...this.state.prayers, [prayer]: { ...this.state.prayers[prayer], ...change } };
    const recent = Object.entries(prayers).slice(-maximumStoredPrayers);
    this.commit({ ...patch, prayers: Object.fromEntries(recent) });
  }

  canBypass(now) { return !this.readError && localDay(now) > this.state.bypassDay; }
  prayer(id) { return this.state.prayers[id]; }
  get streak() { return this.state.streak; }

  bypass(prayer, now) {
    if (!this.canBypass(now) || this.prayer(prayer)?.ended) return false;
    this.record(prayer, { ended: true }, { bypassDay: localDay(now), streak: 0 });
    return true;
  }

  complete(prayer, active) {
    if (this.prayer(prayer)?.ended) return null;
    const streak = this.streak + Number(active);
    this.record(prayer, { ended: true }, { streak });
    return active ? streak : null;
  }

  observe(now, idleSeconds, locked = false) {
    if (locked || idleSeconds >= idleAfterSeconds) {
      this.activeSince = undefined;
    } else {
      if (this.lastSample === undefined || now - this.lastSample > 2500)
        this.activeSince = undefined;
      this.activeSince ??= now;
    }
    this.lastSample = now;
    this.idleSeconds = idleSeconds;
  }

  wasWorking(now) {
    return this.activeSince !== undefined &&
      now - this.activeSince >= transitionSeconds * 1000 &&
      now - this.lastSample <= 2500 &&
      this.idleSeconds < idleAfterSeconds - transitionSeconds;
  }
}

module.exports = PreparationProgress;

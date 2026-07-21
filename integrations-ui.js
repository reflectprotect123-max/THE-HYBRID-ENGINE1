/*
 * Optional provider UI. OAuth, tokens, and provider data stay behind the
 * server-side Netlify functions; this module only adds the Settings entry.
 */
(function () {
  'use strict';

  const ENDPOINTS = Object.freeze({
    status: '/.netlify/functions/integrations-status',
    disconnect: '/.netlify/functions/integrations-disconnect',
    whoopSync: '/.netlify/functions/whoop-sync',
  });
  const PROVIDERS = Object.freeze(['whoop']);
  const baseIntegrationStatus = { whoop: { connected: false } };
  let latestWhoopSample = null;
  let whoopConnected = false;
  let whoopBusy = false;

  function integrationPanel() {
    return '<details class="card" id="integrationCard"><summary class="title">Connected data</summary><div class="meta" style="margin-top:8px">Optional WHOOP recovery, sleep and strain data. Your local training log remains the source of truth.</div><div class="stack" style="margin-top:12px"><div class="settingsrow"><div><div class="title">WHOOP</div><div class="meta" id="whoopIntegrationMeta">Not connected</div></div><div class="btns"><a class="btn small" href="/.netlify/functions/whoop-connect">Connect</a><button class="btn small" type="button" id="whoopSyncButton" onclick="syncIntegration(\'whoop\')" disabled>Sync</button><button class="btn small" type="button" id="whoopDisconnectButton" onclick="disconnectIntegration(\'whoop\')" disabled>Disconnect</button></div></div></div><div class="meta" id="integrationMessage" style="margin-top:10px" aria-live="polite"></div></details>';
  }

  function compactError(value, fallback) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 180) : fallback;
  }

  function formattedDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
  }

  function formattedMetric(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Number.isInteger(number) ? String(number) : number.toFixed(digits).replace(/\.0+$/, '');
  }

  function whoopSampleSummary(sample) {
    if (!sample || typeof sample !== 'object') return '';
    const values = [
      formattedMetric(sample.recoveryScore) && `Recovery ${formattedMetric(sample.recoveryScore)}`,
      formattedMetric(sample.sleepPerformance) && `Sleep ${formattedMetric(sample.sleepPerformance)}%`,
      formattedMetric(sample.hrvMs) && `HRV ${formattedMetric(sample.hrvMs)} ms`,
      formattedMetric(sample.restingHr) && `Resting HR ${formattedMetric(sample.restingHr)} bpm`,
      formattedMetric(sample.strain) && `Strain ${formattedMetric(sample.strain)}`,
    ].filter(Boolean);
    return values.length ? ` · ${values.join(' · ')}` : '';
  }

  function statusLine(provider, row) {
    const error = row?.lastError || row?.error;
    if (!row?.connected) return error ? `Connection error: ${compactError(error, 'Unavailable')}` : 'Not connected';
    const when = formattedDate(row.lastSyncAt) || 'Connected · sync when requested';
    const sample = row.normalized || latestWhoopSample;
    const sampleDate = row.sampleDate || row.lastSampleDate || sample?.date;
    return `${when}${sampleDate ? ` · latest ${String(sampleDate).slice(0, 10)}` : ''}${whoopSampleSummary(sample)}`;
  }

  function whoopScoreState(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return { value: null, tone: 'neutral', label: 'No score yet' };
    const rounded = Math.max(0, Math.min(100, Math.round(score)));
    if (rounded >= 67) return { value: rounded, tone: 'good', label: 'Good recovery' };
    if (rounded >= 34) return { value: rounded, tone: 'watch', label: 'Moderate recovery' };
    return { value: rounded, tone: 'low', label: 'Low recovery' };
  }

  function whoopHomeMetric(label, value, unit = '') {
    const display = formattedMetric(value);
    return `<div class="whoop-home-metric"><span>${label}</span><b>${display || '—'}${display && unit ? ` ${unit}` : ''}</b></div>`;
  }

  function whoopHomePanel() {
    return `<section class="card whoop-home-card" id="whoopHomeCard" aria-labelledby="whoopHomeTitle"><div class="whoop-home-head"><div><div class="eyebrow">WHOOP · TODAY</div><div class="title" id="whoopHomeTitle">Recovery snapshot</div></div><button class="btn small whoop-home-sync" type="button" id="whoopHomeSyncButton" onclick="syncIntegration('whoop')" disabled>Sync</button></div><div id="whoopHomeBody" class="whoop-home-body"><div class="whoop-home-loading">Loading WHOOP data…</div></div></section>`;
  }

  function renderWhoopHome(row, error = null) {
    const body = document.getElementById('whoopHomeBody');
    if (!body) return;
    if (error) {
      body.innerHTML = '<div class="whoop-home-empty"><div><div class="title">WHOOP unavailable</div><div class="meta" id="whoopHomeError"></div></div><a class="btn small" href="/.netlify/functions/whoop-connect">Retry</a></div>';
      const message = document.getElementById('whoopHomeError');
      if (message) message.textContent = compactError(error?.message, 'Try again in a moment.');
      return;
    }
    if (!row?.connected) {
      body.innerHTML = '<div class="whoop-home-empty"><div><div class="title">Connect WHOOP</div><div class="meta">Bring recovery, sleep and strain into today’s view.</div></div><a class="btn small primary" href="/.netlify/functions/whoop-connect">Connect</a></div>';
      return;
    }
    const sample = row.normalized || latestWhoopSample;
    if (!sample) {
      body.innerHTML = '<div class="whoop-home-empty"><div><div class="title">WHOOP connected</div><div class="meta">Sync to bring today’s recovery data into Home.</div></div><button class="btn small primary" type="button" onclick="syncIntegration(\'whoop\')">Sync now</button></div>';
      return;
    }
    const state = whoopScoreState(sample.recoveryScore);
    const score = state.value === null ? 0 : state.value;
    const synced = formattedDate(row.lastSyncAt);
    const balance = typeof window.trainingImpactMini === 'function' ? window.trainingImpactMini() : '';
    body.innerHTML = `<div class="whoop-home-overview"><div class="whoop-home-ring whoop-home-ring--${state.tone}" style="--whoop-score:${score}"><div class="whoop-home-ring-inner"><span>Recovery</span><strong>${state.value === null ? '—' : state.value}</strong><small>${state.value === null ? 'No score' : '/ 100'}</small></div></div><div class="whoop-home-verdict"><span class="pill ${state.tone === 'good' ? 'ok' : ''}">${state.label}</span><div class="meta">${synced ? `Synced ${synced}` : 'Connected · sync when requested'}</div><div class="meta">Your training log remains the source of truth.</div></div></div><div class="whoop-home-metrics">${whoopHomeMetric('Sleep', sample.sleepPerformance, '%')}${whoopHomeMetric('HRV', sample.hrvMs, 'ms')}${whoopHomeMetric('Resting HR', sample.restingHr, 'bpm')}${whoopHomeMetric('Strain', sample.strain)}</div>${balance}`;
  }

  function setMessage(message, isError = false) {
    const node = document.getElementById('integrationMessage');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.state = isError ? 'error' : 'info';
  }

  function updateWhoopActions(connected) {
    const sync = document.getElementById('whoopSyncButton');
    const disconnect = document.getElementById('whoopDisconnectButton');
    const homeSync = document.getElementById('whoopHomeSyncButton');
    if (sync) {
      sync.disabled = !connected || whoopBusy;
      sync.textContent = whoopBusy ? 'Syncing…' : 'Sync';
      sync.setAttribute('aria-busy', whoopBusy ? 'true' : 'false');
    }
    if (disconnect) disconnect.disabled = !connected || whoopBusy;
    if (homeSync) {
      homeSync.disabled = !connected || whoopBusy;
      homeSync.textContent = whoopBusy ? 'Syncing…' : 'Sync';
      homeSync.setAttribute('aria-busy', whoopBusy ? 'true' : 'false');
    }
  }

  function renderIntegrationStatus(data) {
    const whoop = { ...baseIntegrationStatus.whoop, ...(data?.whoop || {}) };
    whoopConnected = whoop.connected === true;
    if (!whoopConnected) latestWhoopSample = null;
    else if (whoop.normalized) latestWhoopSample = whoop.normalized;
    const whoopMeta = document.getElementById('whoopIntegrationMeta');
    if (whoopMeta) whoopMeta.textContent = statusLine('whoop', whoop);
    renderWhoopHome(whoop);
    updateWhoopActions(whoopConnected);
  }

  function callbackNotice() {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration');
    if (!PROVIDERS.includes(provider)) return null;
    const label = 'WHOOP';
    const status = params.get('status');
    if (status === 'connected') return `${label} connected.`;
    if (status === 'denied') return `${label} connection was cancelled.`;
    if (status === 'error') {
      const detail = params.get('message');
      return `${label} connection failed${detail ? `: ${compactError(detail, 'Unknown error')}` : '.'}`;
    }
    return null;
  }

  async function responseData(response) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok) return data || {};
    const error = new Error(data?.error || (data?.connected === false ? 'not_connected' : `Request failed (${response.status})`));
    error.status = response.status;
    error.code = data?.connected === false ? 'not_connected' : data?.error;
    throw error;
  }

  function friendlyError(error, action) {
    if (error?.code === 'not_connected' || error?.status === 401) return 'WHOOP is not connected. Connect it first.';
    return `${action} failed: ${compactError(error?.message, 'Please try again.')}`;
  }

  window.loadIntegrationStatus = function loadIntegrationStatus(options = {}) {
    return fetch(ENDPOINTS.status, { credentials: 'same-origin', cache: 'no-store' })
      .then(responseData)
      .then(data => {
        renderIntegrationStatus(data);
        const notice = options.notice === undefined ? callbackNotice() : options.notice;
        if (notice) setMessage(notice);
        return data;
      })
      .catch(error => {
        renderWhoopHome(null, error);
        setMessage(`Could not load connection status: ${compactError(error?.message, 'Please try again.')}`, true);
        return null;
      });
  };

  window.syncIntegration = function syncIntegration(provider, options) {
    options = options || {};
    if (provider !== 'whoop') {
      setMessage('Sync is currently available for WHOOP only.', true);
      return Promise.resolve(null);
    }
    const backfill = options.backfill === true;
    const silent = options.silent === true;
    whoopBusy = true;
    updateWhoopActions(whoopConnected);
    if (!silent) setMessage('Syncing WHOOP…');
    const url = backfill ? `${ENDPOINTS.whoopSync}?backfill=1` : ENDPOINTS.whoopSync;
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(responseData)
      .then(data => {
        if (data.connected === false) throw Object.assign(new Error('not_connected'), { code: 'not_connected', status: 401 });
        latestWhoopSample = data.normalized || latestWhoopSample;
        if (Array.isArray(data.dailyStrain) && typeof window.mergeFitnessDailyStrain === 'function') {
          window.mergeFitnessDailyStrain(data.dailyStrain, { backfill });
        }
        if (Array.isArray(data.dailyRecovery) && typeof window.mergeFitnessDailyRecovery === 'function') {
          window.mergeFitnessDailyRecovery(data.dailyRecovery);
        }
        if (!silent) setMessage('WHOOP synced.');
        const currentS = typeof S !== 'undefined' ? S : null;
        const needsBackfill = !backfill && currentS && currentS.fitness && !currentS.fitness.backfilled;
        const afterStatus = window.loadIntegrationStatus({ notice: silent ? null : 'WHOOP synced.' }).then(() => data);
        if (needsBackfill) return afterStatus.then(result => syncIntegration('whoop', { backfill: true, silent: true }).then(() => result));
        return afterStatus;
      })
      .catch(error => {
        if (!silent) setMessage(friendlyError(error, 'WHOOP sync'), true);
        return null;
      })
      .finally(() => {
        whoopBusy = false;
        updateWhoopActions(whoopConnected);
      });
  };

  window.disconnectIntegration = function disconnectIntegration(provider) {
    if (provider !== 'whoop') {
      setMessage('Unknown integration.', true);
      return Promise.resolve(null);
    }
    const label = 'WHOOP';
    whoopBusy = true;
    updateWhoopActions(true);
    setMessage(`Disconnecting ${label}…`);
    return fetch(`${ENDPOINTS.disconnect}?provider=${encodeURIComponent(provider)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(responseData)
      .then(data => {
        latestWhoopSample = null;
        setMessage(`${label} disconnected.`);
        return window.loadIntegrationStatus({ notice: `${label} disconnected.` }).then(() => data);
      })
      .catch(error => {
        setMessage(`${label} disconnect failed: ${compactError(error?.message, 'Please try again.')}`, true);
        return null;
      })
      .finally(() => {
        whoopBusy = false;
        updateWhoopActions(whoopConnected);
      });
  };

  const settingsCore = window.settings;
  if (typeof settingsCore === 'function') {
    window.settings = settings = function settingsWithIntegrations() {
      settingsCore();
      const root = document.getElementById('appScreen');
      const stack = root?.querySelector('.stack');
      if (!stack) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = integrationPanel();
      stack.insertBefore(wrapper.firstElementChild, stack.children[1] || null);
      window.loadIntegrationStatus();
    };
  }

  const homeCore = window.home;
  if (typeof homeCore === 'function') {
    window.home = home = function homeWithIntegrations() {
      homeCore();
      const root = document.getElementById('appScreen');
      const slot = root?.querySelector('#whoopHomeSlot');
      if (slot) {
        slot.outerHTML = whoopHomePanel();
        window.loadIntegrationStatus({ notice: null });
        return;
      }
      const stack = root?.querySelector('.stack');
      if (!stack) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = whoopHomePanel();
      const anchor = [...stack.children].find(child => !['Active workout', 'Today'].includes(child.querySelector('.eyebrow')?.textContent?.trim()));
      stack.insertBefore(wrapper.firstElementChild, anchor || null);
      window.loadIntegrationStatus({ notice: null });
    };
  }
})();

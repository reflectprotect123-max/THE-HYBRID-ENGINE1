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
  const PROVIDERS = Object.freeze(['whoop', 'strava']);
  const baseIntegrationStatus = { whoop: { connected: false }, strava: { connected: false } };
  let latestWhoopSample = null;
  let whoopConnected = false;
  let whoopBusy = false;

  function integrationPanel() {
    return '<details class="card" id="integrationCard"><summary class="title">Connected data</summary><div class="meta" style="margin-top:8px">Optional WHOOP recovery/sleep and Strava activity data. Your local training log remains the source of truth.</div><div class="stack" style="margin-top:12px"><div class="settingsrow"><div><div class="title">WHOOP</div><div class="meta" id="whoopIntegrationMeta">Not connected</div></div><div class="btns"><a class="btn small" href="/.netlify/functions/whoop-connect">Connect</a><button class="btn small" type="button" id="whoopSyncButton" onclick="syncIntegration(\'whoop\')" disabled>Sync</button><button class="btn small" type="button" id="whoopDisconnectButton" onclick="disconnectIntegration(\'whoop\')" disabled>Disconnect</button></div></div><div class="divider"></div><div class="settingsrow"><div><div class="title">Strava</div><div class="meta" id="stravaIntegrationMeta">Not connected</div></div><div class="btns"><a class="btn small" href="/.netlify/functions/strava-connect">Connect</a><button class="btn small" type="button" onclick="disconnectIntegration(\'strava\')">Disconnect</button></div></div></div><div class="meta" id="integrationMessage" style="margin-top:10px" aria-live="polite"></div></details>';
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
    if (provider === 'strava') return `${when} · ${Number(row.activityCount) || 0} recent activities`;
    const sample = row.normalized || latestWhoopSample;
    const sampleDate = row.sampleDate || row.lastSampleDate || sample?.date;
    return `${when}${sampleDate ? ` · latest ${String(sampleDate).slice(0, 10)}` : ''}${whoopSampleSummary(sample)}`;
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
    if (sync) {
      sync.disabled = !connected || whoopBusy;
      sync.textContent = whoopBusy ? 'Syncing…' : 'Sync';
      sync.setAttribute('aria-busy', whoopBusy ? 'true' : 'false');
    }
    if (disconnect) disconnect.disabled = !connected || whoopBusy;
  }

  function renderIntegrationStatus(data) {
    const whoop = { ...baseIntegrationStatus.whoop, ...(data?.whoop || {}) };
    const strava = { ...baseIntegrationStatus.strava, ...(data?.strava || {}) };
    whoopConnected = whoop.connected === true;
    if (!whoopConnected) latestWhoopSample = null;
    else if (whoop.normalized) latestWhoopSample = whoop.normalized;
    const whoopMeta = document.getElementById('whoopIntegrationMeta');
    const stravaMeta = document.getElementById('stravaIntegrationMeta');
    if (whoopMeta) whoopMeta.textContent = statusLine('whoop', whoop);
    if (stravaMeta) stravaMeta.textContent = statusLine('strava', strava);
    updateWhoopActions(whoopConnected);
  }

  function callbackNotice() {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('integration');
    if (!PROVIDERS.includes(provider)) return null;
    const label = provider === 'whoop' ? 'WHOOP' : 'Strava';
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
        setMessage(`Could not load connection status: ${compactError(error?.message, 'Please try again.')}`, true);
        return null;
      });
  };

  window.syncIntegration = function syncIntegration(provider) {
    if (provider !== 'whoop') {
      setMessage('Sync is currently available for WHOOP only.', true);
      return Promise.resolve(null);
    }
    whoopBusy = true;
    updateWhoopActions(whoopConnected);
    setMessage('Syncing WHOOP…');
    return fetch(ENDPOINTS.whoopSync, { credentials: 'same-origin', cache: 'no-store' })
      .then(responseData)
      .then(data => {
        if (data.connected === false) throw Object.assign(new Error('not_connected'), { code: 'not_connected', status: 401 });
        latestWhoopSample = data.normalized || latestWhoopSample;
        setMessage('WHOOP synced.');
        return window.loadIntegrationStatus({ notice: 'WHOOP synced.' }).then(() => data);
      })
      .catch(error => {
        setMessage(friendlyError(error, 'WHOOP sync'), true);
        return null;
      })
      .finally(() => {
        whoopBusy = false;
        updateWhoopActions(Boolean(document.getElementById('whoopIntegrationMeta')?.textContent && document.getElementById('whoopIntegrationMeta').textContent !== 'Not connected'));
      });
  };

  window.disconnectIntegration = function disconnectIntegration(provider) {
    if (!PROVIDERS.includes(provider)) {
      setMessage('Unknown integration.', true);
      return Promise.resolve(null);
    }
    const label = provider === 'whoop' ? 'WHOOP' : 'Strava';
    if (provider === 'whoop') {
      whoopBusy = true;
      updateWhoopActions(true);
    }
    setMessage(`Disconnecting ${label}…`);
    return fetch(`${ENDPOINTS.disconnect}?provider=${encodeURIComponent(provider)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(responseData)
      .then(data => {
        if (provider === 'whoop') latestWhoopSample = null;
        setMessage(`${label} disconnected.`);
        return window.loadIntegrationStatus({ notice: `${label} disconnected.` }).then(() => data);
      })
      .catch(error => {
        setMessage(`${label} disconnect failed: ${compactError(error?.message, 'Please try again.')}`, true);
        return null;
      })
      .finally(() => {
        if (provider === 'whoop') {
          whoopBusy = false;
          updateWhoopActions(whoopConnected);
        }
      });
  };

  const settingsCore = window.settings;
  if (typeof settingsCore !== 'function') return;
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
})();

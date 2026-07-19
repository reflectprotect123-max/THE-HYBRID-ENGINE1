(function (root) {
  'use strict';

  if (!root) return;

  var STATE_KEY = '__privatePwaEnhancementV1';
  var previous = root[STATE_KEY];

  // Loading this file more than once should reuse the first instance.
  if (previous && typeof previous.init === 'function') {
    root.installPrivatePwa = previous.install;
    previous.init();
    return;
  }

  var state = {
    initialized: false,
    domReady: false,
    domReadyListenerBound: false,
    windowListenersBound: false,
    serviceWorkerTarget: null,
    serviceWorkerListener: null,
    serviceWorkerRegistration: null,
    controllerListenerBound: false,
    refreshOnControllerChange: false,
    registrationBound: false,
    mediaQuery: null,
    mediaListenerBound: false,
    deferredPrompt: null,
    installed: false,
    standalone: false,
    updateAvailable: false,
    controls: null,
    status: null,
    installButton: null,
    updateControl: null,
    updateButton: null
  };

  root[STATE_KEY] = state;

  function documentRef() {
    return root.document || null;
  }

  function navigatorRef() {
    return root.navigator || {};
  }

  function query(selector) {
    var doc = documentRef();
    if (!doc || typeof doc.querySelector !== 'function') return null;
    try {
      return doc.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function addListener(target, type, listener) {
    if (!target || typeof target.addEventListener !== 'function') return false;
    target.addEventListener(type, listener);
    return true;
  }

  function removeNode(node) {
    if (node && node.parentNode && typeof node.parentNode.removeChild === 'function') {
      node.parentNode.removeChild(node);
    }
  }

  function setStyles(element, styles) {
    if (!element || !element.style) return;
    Object.keys(styles).forEach(function (key) {
      element.style[key] = styles[key];
    });
  }

  function mountTarget() {
    var doc = documentRef();
    if (!doc) return null;
    return query('.topright') || query('.top') || query('.app') || doc.body || doc.documentElement || null;
  }

  function ensureControls() {
    var doc = documentRef();
    if (!doc || typeof doc.createElement !== 'function') return null;

    if (state.controls && state.controls.parentNode) return state.controls;

    var controls = query('[data-private-pwa-controls]');
    var created = false;
    if (!controls) {
      controls = doc.createElement('div');
      controls.setAttribute('data-private-pwa-controls', '');
      controls.className = 'pwa-controls';
      setStyles(controls, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        minWidth: '0'
      });
      created = true;
    }

    if (!controls.parentNode) {
      var target = mountTarget();
      if (!target || typeof target.appendChild !== 'function') return null;
      target.appendChild(controls);
      if (created && (target === doc.body || target === doc.documentElement)) {
        setStyles(controls, {
          position: 'fixed',
          top: '12px',
          right: '12px',
          zIndex: '1000',
          maxWidth: 'calc(100vw - 24px)',
          justifyContent: 'flex-end'
        });
      }
    }

    state.controls = controls;
    return controls;
  }

  function ensureStatus() {
    var doc = documentRef();
    var controls = ensureControls();
    if (!doc || !controls || typeof doc.createElement !== 'function') return null;
    if (state.status && state.status.parentNode) return state.status;

    var status = query('[data-private-pwa-status]');
    var created = false;
    if (!status) {
      status = doc.createElement('span');
      status.setAttribute('data-private-pwa-status', '');
      status.className = 'pwa-network-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      setStyles(status, {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 7px',
        border: '1px solid rgba(156, 180, 139, .45)',
        borderRadius: '999px',
        color: '#b7ccaa',
        background: 'rgba(156, 180, 139, .08)',
        fontSize: '10px',
        fontWeight: '700',
        lineHeight: '1.2',
        whiteSpace: 'nowrap'
      });
      created = true;
    }

    if (created || !status.parentNode) controls.appendChild(status);
    state.status = status;
    return status;
  }

  function setNetworkStatus() {
    var status = ensureStatus();
    if (!status) return;

    var online = navigatorRef().onLine !== false;
    status.textContent = online ? 'Online' : 'Offline';
    status.setAttribute('data-state', online ? 'online' : 'offline');
    status.setAttribute('aria-label', 'Network status: ' + (online ? 'online' : 'offline'));
    if (status.classList) {
      status.classList.toggle('pwa-online', online);
      status.classList.toggle('pwa-offline', !online);
    }
    setStyles(status, online ? {
      display: 'none',
      borderColor: 'rgba(156, 180, 139, .45)',
      color: '#b7ccaa',
      background: 'rgba(156, 180, 139, .08)'
    } : {
      display: 'inline-flex',
      borderColor: 'rgba(203, 129, 116, .55)',
      color: '#e7a59a',
      background: 'rgba(203, 129, 116, .09)'
    });
  }

  function standaloneMediaQuery() {
    if (state.mediaQuery) return state.mediaQuery;
    if (typeof root.matchMedia !== 'function') return null;
    try {
      state.mediaQuery = root.matchMedia('(display-mode: standalone)');
    } catch (_) {
      state.mediaQuery = null;
    }
    return state.mediaQuery;
  }

  function isStandalone() {
    var nav = navigatorRef();
    var media = standaloneMediaQuery();
    return nav.standalone === true || !!(media && media.matches);
  }

  function removeInstallButton() {
    removeNode(state.installButton);
    state.installButton = null;
  }

  function setStandaloneClass() {
    var standalone = isStandalone();
    state.standalone = standalone;
    var doc = documentRef();
    if (doc) {
      [doc.documentElement, doc.body].forEach(function (element) {
        if (!element || !element.classList) return;
        element.classList.toggle('standalone-mode', standalone);
        element.classList.toggle('pwa-standalone', standalone);
      });
    }
    if (standalone) removeInstallButton();
  }

  function installPrivatePwa() {
    var promptEvent = state.deferredPrompt;
    if (!promptEvent || state.standalone || state.installed || typeof promptEvent.prompt !== 'function') {
      return Promise.resolve(false);
    }

    state.deferredPrompt = null;
    removeInstallButton();

    var promptResult;
    try {
      promptResult = promptEvent.prompt();
    } catch (_) {
      return Promise.resolve(false);
    }

    return Promise.resolve(promptResult)
      .then(function () {
        return promptEvent.userChoice;
      })
      .then(function (choice) {
        return !!choice && choice.outcome === 'accepted';
      })
      .catch(function () {
        return false;
      });
  }

  function ensureInstallButton() {
    if (!state.deferredPrompt || state.standalone || state.installed) return;
    var doc = documentRef();
    var controls = ensureControls();
    if (!doc || !controls || typeof doc.createElement !== 'function') return;

    var button = state.installButton && state.installButton.parentNode
      ? state.installButton
      : query('[data-private-pwa-install]');
    var created = false;
    if (!button) {
      button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute('data-private-pwa-install', '');
      button.className = 'pwa-install-button';
      button.textContent = 'Install app';
      button.setAttribute('aria-label', 'Install this app');
      setStyles(button, {
        minHeight: '32px',
        padding: '6px 9px',
        border: '1px solid rgba(224, 188, 135, .65)',
        borderRadius: '999px',
        color: '#17120c',
        background: '#c09358',
        fontSize: '11px',
        fontWeight: '800',
        lineHeight: '1.2',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      });
      created = true;
    }

    if (!button.parentNode) controls.appendChild(button);
    if (!button.__privatePwaListenerBound && typeof button.addEventListener === 'function') {
      button.addEventListener('click', function () {
        installPrivatePwa();
      });
      button.__privatePwaListenerBound = true;
    }
    if (!created && !button.textContent) button.textContent = 'Install app';
    state.installButton = button;
  }

  function handleBeforeInstallPrompt(event) {
    if (!event) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (state.standalone || state.installed || typeof event.prompt !== 'function') return;

    state.deferredPrompt = event;
    if (state.domReady) ensureInstallButton();
  }

  function handleAppInstalled() {
    state.installed = true;
    state.deferredPrompt = null;
    removeInstallButton();
    setStandaloneClass();
  }

  function updateMessageType(data) {
    if (typeof data === 'string') return data.toUpperCase().replace(/[\s-]+/g, '_');
    if (!data || typeof data !== 'object') return '';
    return String(data.type || data.event || data.kind || '').toUpperCase().replace(/[\s-]+/g, '_');
  }

  function isUpdateMessage(data) {
    if (!data) return false;
    if (data.updateAvailable === true || data.newVersion === true) return true;
    var type = updateMessageType(data);
    return [
      'UPDATE',
      'UPDATE_AVAILABLE',
      'UPDATE_READY',
      'APP_UPDATE_AVAILABLE',
      'PWA_UPDATE_AVAILABLE',
      'SERVICE_WORKER_UPDATE',
      'SERVICE_WORKER_UPDATE_AVAILABLE',
      'SW_UPDATE',
      'SW_UPDATE_AVAILABLE',
      'NEW_VERSION',
      'NEW_VERSION_AVAILABLE'
    ].indexOf(type) !== -1;
  }

  function refreshForUpdate() {
    if (state.updateButton) {
      state.updateButton.disabled = true;
      state.updateButton.textContent = 'Refreshing…';
    }
    state.refreshOnControllerChange = true;
    var waiting = state.serviceWorkerRegistration && state.serviceWorkerRegistration.waiting;
    if (waiting && typeof waiting.postMessage === 'function') {
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    try {
      if (root.location && typeof root.location.reload === 'function') root.location.reload();
    } catch (_) {
      // A host may intentionally disable navigation; leave the rest of the app untouched.
    }
  }

  function ensureUpdateControl() {
    if (!state.updateAvailable) return;
    var doc = documentRef();
    var controls = ensureControls();
    if (!doc || !controls || typeof doc.createElement !== 'function') return;

    var updateControl = state.updateControl && state.updateControl.parentNode
      ? state.updateControl
      : query('[data-private-pwa-update]');
    if (!updateControl) {
      updateControl = doc.createElement('div');
      updateControl.setAttribute('data-private-pwa-update', '');
      updateControl.className = 'pwa-update-control';
      updateControl.setAttribute('role', 'status');
      updateControl.setAttribute('aria-live', 'polite');
      setStyles(updateControl, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '4px 6px',
        border: '1px solid rgba(212, 163, 91, .55)',
        borderRadius: '999px',
        color: '#e0bc87',
        background: 'rgba(212, 163, 91, .09)',
        fontSize: '10px',
        fontWeight: '700',
        lineHeight: '1.2',
        whiteSpace: 'nowrap'
      });

      var label = doc.createElement('span');
      label.textContent = 'Update ready';
      updateControl.appendChild(label);

      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'pwa-refresh-button';
      button.textContent = 'Refresh';
      button.setAttribute('aria-label', 'Refresh to load the update');
      setStyles(button, {
        padding: '2px 4px',
        border: '0',
        color: '#e0bc87',
        background: 'transparent',
        fontSize: '10px',
        fontWeight: '850',
        cursor: 'pointer',
        textDecoration: 'underline',
        textUnderlineOffset: '2px'
      });
      button.addEventListener('click', refreshForUpdate);
      updateControl.appendChild(button);
      state.updateButton = button;
    } else {
      state.updateButton = updateControl.querySelector
        ? updateControl.querySelector('.pwa-refresh-button')
        : null;
    }

    if (!updateControl.parentNode) controls.appendChild(updateControl);
    state.updateControl = updateControl;
  }

  function handleServiceWorkerMessage(event) {
    if (!event || !isUpdateMessage(event.data)) return;
    state.updateAvailable = true;
    if (state.domReady) ensureUpdateControl();
  }

  function bindServiceWorkerMessages() {
    var serviceWorker = navigatorRef().serviceWorker;
    if (!serviceWorker || typeof serviceWorker.addEventListener !== 'function') return;
    if (state.serviceWorkerTarget === serviceWorker) return;

    if (state.serviceWorkerTarget && state.serviceWorkerListener &&
        typeof state.serviceWorkerTarget.removeEventListener === 'function') {
      state.serviceWorkerTarget.removeEventListener('message', state.serviceWorkerListener);
    }

    state.serviceWorkerTarget = serviceWorker;
    state.serviceWorkerListener = handleServiceWorkerMessage;
    serviceWorker.addEventListener('message', state.serviceWorkerListener);
  }

  function handleControllerChange() {
    if (!state.refreshOnControllerChange) return;
    state.refreshOnControllerChange = false;
    try {
      if (root.location && typeof root.location.reload === 'function') root.location.reload();
    } catch (_) {
      // A host may intentionally disable navigation; leave the app state alone.
    }
  }

  function registerServiceWorker() {
    var serviceWorker = navigatorRef().serviceWorker;
    if (!serviceWorker || typeof serviceWorker.register !== 'function') return;
    if (!state.controllerListenerBound && typeof serviceWorker.addEventListener === 'function') {
      serviceWorker.addEventListener('controllerchange', handleControllerChange);
      state.controllerListenerBound = true;
    }
    if (state.registrationBound) return;
    state.registrationBound = true;

    var registrationPromise;
    try {
      registrationPromise = serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
    } catch (_) {
      state.registrationBound = false;
      return;
    }

    Promise.resolve(registrationPromise).then(function (registration) {
      state.serviceWorkerRegistration = registration;
      root.hybridPwaRegistration = registration;

      function observe(worker) {
        if (!worker || typeof worker.addEventListener !== 'function') return;
        worker.addEventListener('statechange', function () {
          if (worker.state !== 'installed') return;
          if (serviceWorker.controller) {
            state.updateAvailable = true;
            if (state.domReady) ensureUpdateControl();
          } else if (typeof worker.postMessage === 'function') {
            // First install: take control quietly; an update is user-confirmed.
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      }

      if (registration.waiting) {
        if (serviceWorker.controller) {
          state.updateAvailable = true;
          if (state.domReady) ensureUpdateControl();
        } else if (typeof registration.waiting.postMessage === 'function') {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      observe(registration.installing);
      if (typeof registration.addEventListener === 'function') {
        registration.addEventListener('updatefound', function () {
          observe(registration.installing);
        });
      }
      if (typeof registration.update === 'function') registration.update().catch(function () {});
      var doc = documentRef();
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', function () {
          if (doc.visibilityState === 'visible' && typeof registration.update === 'function') {
            registration.update().catch(function () {});
          }
        });
      }
    }).catch(function () {
      state.registrationBound = false;
    });
  }

  function bindMediaQuery() {
    var media = standaloneMediaQuery();
    if (!media || state.mediaListenerBound) return;
    var listener = function () {
      setStandaloneClass();
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', listener);
      state.mediaListenerBound = true;
    } else if (typeof media.addListener === 'function') {
      media.addListener(listener);
      state.mediaListenerBound = true;
    }
  }

  function onDomReady() {
    if (state.domReady) return;
    state.domReady = true;
    setStandaloneClass();
    ensureStatus();
    setNetworkStatus();
    ensureInstallButton();
    ensureUpdateControl();
    bindServiceWorkerMessages();
  }

  function init() {
    if (!state.windowListenersBound && typeof root.addEventListener === 'function') {
      addListener(root, 'beforeinstallprompt', handleBeforeInstallPrompt);
      addListener(root, 'appinstalled', handleAppInstalled);
      addListener(root, 'online', setNetworkStatus);
      addListener(root, 'offline', setNetworkStatus);
      state.windowListenersBound = true;
    }

    bindServiceWorkerMessages();
    registerServiceWorker();
    bindMediaQuery();
    setStandaloneClass();

    var doc = documentRef();
    if (!doc) return root.installPrivatePwa;
    if (doc.readyState === 'loading') {
      if (!state.domReadyListenerBound) {
        state.domReadyListenerBound = addListener(doc, 'DOMContentLoaded', onDomReady);
      }
    } else {
      onDomReady();
    }
    return root.installPrivatePwa;
  }

  state.init = init;
  state.install = installPrivatePwa;
  root.installPrivatePwa = installPrivatePwa;
  init();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

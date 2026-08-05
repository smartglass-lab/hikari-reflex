(function() {
  'use strict';

  // ==================== CONFIG ====================
  var CONFIG = {
    totalRounds: 5,
    minDelayMs: 1500,      // shortest "まて…" wait before the flash
    maxDelayMs: 4000,      // longest "まて…" wait before the flash
    earlyDisplayMs: 1000,  // how long "はやすぎ！" stays up before retrying
    resultDisplayMs: 1100, // how long the per-round ms result stays up
    storageKey: 'mdg_hikari_reflex',
  };

  // ==================== STATE ====================
  var state = {
    currentScreen: null,
    screenHistory: [],

    phase: 'idle',      // 'idle' | 'waiting' | 'early' | 'go' | 'result'
    round: 1,
    roundTimes: [],
    goTimestamp: null,
    pendingTimer: null, // single in-flight setTimeout handle for the round flow
    summary: null,
  };

  // ==================== DOM REFS ====================
  var screens = {};

  function collectScreens() {
    document.querySelectorAll('.screen').forEach(function(s) {
      if (s.id) screens[s.id] = s;
    });
  }

  // ==================== NAVIGATION ====================
  function navigateTo(screenId, options) {
    options = options || {};
    var addToHistory = options.addToHistory !== false;

    // Leaving a screen always cancels whatever round timer (GO-flip, retry,
    // auto-advance) was in flight. This is what keeps the false-start /
    // go-flip scheduling from ever firing against a screen the player has
    // already left, and from stacking across rounds.
    clearRoundTimer();

    if (addToHistory && state.currentScreen) {
      state.screenHistory.push(state.currentScreen);
    }

    Object.keys(screens).forEach(function(id) { screens[id].classList.add('hidden'); });
    if (screens[screenId]) {
      screens[screenId].classList.remove('hidden');
      state.currentScreen = screenId;
      onScreenEnter(screenId);
      focusFirst(screens[screenId]);
    }
  }

  function navigateBack() {
    if (state.screenHistory.length > 0) {
      navigateTo(state.screenHistory.pop(), { addToHistory: false });
    }
  }

  // ==================== FOCUS MANAGEMENT ====================
  function focusFirst(container) {
    var el = container.querySelector('.focusable:not([disabled]):not(.hidden)');
    if (el) el.focus();
  }

  function moveFocus(direction) {
    var container = screens[state.currentScreen];
    if (!container) return;

    var focusables = Array.from(
      container.querySelectorAll('.focusable:not([disabled]):not(.hidden)')
    );
    if (focusables.length === 0) return;

    var current = document.activeElement;
    var idx = focusables.indexOf(current);

    if (idx === -1) {
      focusFirst(container);
      return;
    }

    var nextIdx;
    if (direction === 'up' || direction === 'left') {
      nextIdx = idx > 0 ? idx - 1 : focusables.length - 1;
    } else {
      nextIdx = idx < focusables.length - 1 ? idx + 1 : 0;
    }
    focusables[nextIdx].focus();
  }

  // ==================== STORAGE (all-time best) ====================
  function loadBestScore() {
    try {
      var raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && typeof data.bestMs === 'number' && isFinite(data.bestMs)) {
        return data.bestMs;
      }
      return null;
    } catch (e) {
      console.error('[Storage] load error:', e);
      return null;
    }
  }

  function saveBestScore(ms) {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({ bestMs: ms }));
    } catch (e) {
      console.error('[Storage] save error:', e);
    }
  }

  // ==================== GAME FLOW ====================
  function clearRoundTimer() {
    if (state.pendingTimer !== null) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
  }

  function beginGame() {
    state.screenHistory = ['home'];
    state.round = 1;
    state.roundTimes = [];
    state.summary = null;
    navigateTo('round', { addToHistory: false });
  }

  function startRound() {
    clearRoundTimer();
    state.phase = 'waiting';
    state.goTimestamp = null;

    var counter = document.getElementById('round-counter');
    if (counter) counter.textContent = 'ラウンド ' + state.round + '/' + CONFIG.totalRounds;
    setFlashPhase('wait', 'まて…');

    var delay = CONFIG.minDelayMs + Math.random() * (CONFIG.maxDelayMs - CONFIG.minDelayMs);
    state.pendingTimer = setTimeout(function() {
      state.pendingTimer = null;
      showGo();
    }, delay);
  }

  function showGo() {
    state.phase = 'go';
    // Synchronous fallback timestamp so goTimestamp is never null the instant
    // phase flips to 'go' (guards a same-frame tap landing before the rAF
    // callback below runs). Refined a few lines down to track actual paint.
    state.goTimestamp = performance.now();
    setFlashPhase('go', '今だ！');
    requestAnimationFrame(function() {
      state.goTimestamp = performance.now();
    });
  }

  function onFalseStart() {
    clearRoundTimer();
    state.phase = 'early';
    setFlashPhase('early', 'はやすぎ！');
    state.pendingTimer = setTimeout(function() {
      state.pendingTimer = null;
      startRound(); // same round, freshly randomized delay — forgiving, not punishing
    }, CONFIG.earlyDisplayMs);
  }

  function onValidTap() {
    var elapsed = Math.max(0, Math.round(performance.now() - state.goTimestamp));
    state.roundTimes.push(elapsed);

    clearRoundTimer();
    state.phase = 'result';
    setFlashPhase('result', elapsed + 'ms');
    state.pendingTimer = setTimeout(function() {
      state.pendingTimer = null;
      advanceRound();
    }, CONFIG.resultDisplayMs);
  }

  function advanceRound() {
    if (state.round >= CONFIG.totalRounds) {
      finishGame();
    } else {
      state.round += 1;
      startRound();
    }
  }

  function finishGame() {
    var times = state.roundTimes;
    var sum = times.reduce(function(a, b) { return a + b; }, 0);
    var avg = Math.round(sum / times.length);
    var best = Math.min.apply(null, times);

    var allTimeBest = loadBestScore();
    var newBest = false;
    if (allTimeBest === null || best < allTimeBest) {
      allTimeBest = best;
      newBest = true;
      saveBestScore(allTimeBest);
    }

    state.summary = {
      avg: avg,
      best: best,
      allTimeBest: allTimeBest,
      newBest: newBest,
      flavor: flavorFor(avg),
    };

    navigateTo('summary', { addToHistory: false });
  }

  function flavorFor(avg) {
    if (avg < 220) return '反射神経すごい！';
    if (avg <= 320) return '平均的です';
    return 'ウォーミングアップ中？';
  }

  function onRoundTap() {
    if (state.phase === 'waiting') {
      onFalseStart();
    } else if (state.phase === 'go') {
      onValidTap();
    }
    // 'early' and 'result' phases ignore taps — those are non-interactive,
    // auto-advancing beats on their own timer.
  }

  // ==================== UI RENDER ====================
  var FLASH_PHASES = ['wait', 'early', 'go', 'result'];

  function setFlashPhase(phase, text) {
    var zone = document.getElementById('flash-zone');
    if (!zone) return;
    FLASH_PHASES.forEach(function(p) { zone.classList.remove('phase-' + p); });
    zone.classList.add('phase-' + phase);
    var textEl = document.getElementById('flash-text');
    if (textEl) textEl.textContent = text;
  }

  function renderHomeBest() {
    var best = loadBestScore();
    var wrap = document.getElementById('home-best-preview');
    if (!wrap) return;
    if (best !== null) {
      document.getElementById('home-best-value').textContent = best;
      wrap.classList.remove('hidden');
    } else {
      wrap.classList.add('hidden');
    }
  }

  function renderSummary() {
    var s = state.summary;
    if (!s) return;
    document.getElementById('summary-avg').textContent = s.avg;
    document.getElementById('summary-best').textContent = s.best;
    document.getElementById('summary-flavor').textContent = s.flavor;
    document.getElementById('summary-alltime-value').textContent = s.allTimeBest;
    document.getElementById('new-best-tag').classList.toggle('hidden', !s.newBest);
  }

  // ==================== SCREEN LIFECYCLE ====================
  function onScreenEnter(screenId) {
    if (screenId === 'home') {
      state.phase = 'idle';
      renderHomeBest();
    } else if (screenId === 'round') {
      startRound();
    } else if (screenId === 'summary') {
      state.phase = 'idle';
      renderSummary();
    }
  }

  // ==================== ACTION HANDLING ====================
  function handleAction(action, element) {
    switch (action) {
      case 'back':
        navigateBack();
        break;
      default:
        handleAppAction(action, element);
        break;
    }
  }

  function handleAppAction(action, element) {
    switch (action) {
      case 'start':
      case 'retry':
        beginGame();
        break;
      case 'round-tap':
        onRoundTap();
        break;
      default:
        console.log('[Action]', action);
        break;
    }
  }

  // ==================== EVENT LISTENERS ====================
  function setupEvents() {
    document.addEventListener('click', function(e) {
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) handleAction(actionEl.dataset.action, actionEl);
    });

    document.addEventListener('keydown', function(e) {
      switch (e.key) {
        case 'ArrowUp':
          moveFocus('up');
          e.preventDefault();
          break;
        case 'ArrowDown':
          moveFocus('down');
          e.preventDefault();
          break;
        case 'ArrowLeft':
          moveFocus('left');
          e.preventDefault();
          break;
        case 'ArrowRight':
          moveFocus('right');
          e.preventDefault();
          break;
        case 'Enter':
          if (document.activeElement && document.activeElement.classList.contains('focusable')) {
            document.activeElement.click();
          }
          e.preventDefault();
          break;
        case 'Escape':
          // PC-testing convenience only — glasses have no back gesture.
          // Every screen already offers an in-UI back path.
          navigateBack();
          e.preventDefault();
          break;
      }
    });
  }

  // ==================== INITIALIZATION ====================
  function init() {
    collectScreens();
    setupEvents();
    navigateTo('home', { addToHistory: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

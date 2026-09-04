/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';

function initStemUploader() {
  // Allowed audio extensions
  const ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.aiff', '.aif'];

  // Application State
  let selectedStems = [];
  let metromateProjects = [];
  let selectedProjectId = null;
  let rawStoredUrl = localStorage.getItem('metromate_api_url') || 'http://localhost:5050';
  let metromateApiUrl = rawStoredUrl.replace(/\/\/0\.0\.0\.0(?::|$)/, (m) => m.replace('0.0.0.0', '127.0.0.1')).replace(/\/+$/, '');
  let rawStoredWebUrl = localStorage.getItem('metromate_web_url') || 'http://localhost:3000';
  let metromateWebUrl = rawStoredWebUrl.replace(/\/\/0\.0\.0\.0(?::|$)/, (m) => m.replace('0.0.0.0', '127.0.0.1')).replace(/\/+$/, '');
  let metromateAuthToken = localStorage.getItem('metromate_auth_token') || '';
  let currentUser = null;
  try {
    currentUser = JSON.parse(localStorage.getItem('metromate_user') || 'null');
  } catch (e) {
    currentUser = null;
  }

  // DOM Elements - User Authentication
  const openLoginBtn = document.getElementById('open-login-btn');
  const userProfileWidget = document.getElementById('user-profile-widget');
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  const userDisplayName = document.getElementById('user-display-name');
  const logoutBtn = document.getElementById('logout-btn');
  const loginModal = document.getElementById('login-modal');
  const closeLoginModalBtn = document.getElementById('close-login-modal-btn');
  const loginForm = document.getElementById('login-form');
  const loginEmail = document.getElementById('login-email');
  const loginPassword = document.getElementById('login-password');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const submitLoginBtn = document.getElementById('submit-login-btn');

  // DOM Elements - Navigation & Cards
  const wizardStepper = document.getElementById('wizard-stepper');
  const uploadCard = document.getElementById('upload-card');
  const selectedStemsCard = document.getElementById('selected-stems-card');
  const projectSelectionCard = document.getElementById('project-selection-card');
  const uploadProgressCard = document.getElementById('upload-progress-card');
  const uploadSuccessCard = document.getElementById('upload-success-card');

  // DOM Elements - Controls & Inputs
  const startUploadBtn = document.getElementById('start-upload-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const dragDropZone = document.getElementById('drag-drop-zone');
  const stemsList = document.getElementById('stems-list');
  const stemsCountBadge = document.getElementById('stems-count-badge');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const addMoreStemsBtn = document.getElementById('add-more-stems-btn');
  const continueToProjectsBtn = document.getElementById('continue-to-projects-btn');

  // DOM Elements - Project Selection
  const connectionStatusBadge = document.getElementById('connection-status-badge');
  const connectionStatusText = document.getElementById('connection-status-text');
  const refreshProjectsBtn = document.getElementById('refresh-projects-btn');
  const projectSearchInput = document.getElementById('project-search-input');
  const projectsList = document.getElementById('projects-list');
  const backToStemsBtn = document.getElementById('back-to-stems-btn');
  const startUploadToProjectBtn = document.getElementById('start-upload-to-project-btn');

  // DOM Elements - Uploading & Progress
  const overallProgressText = document.getElementById('overall-progress-text');
  const overallProgressPercent = document.getElementById('overall-progress-percent');
  const overallProgressFill = document.getElementById('overall-progress-fill');
  const uploadingStemsList = document.getElementById('uploading-stems-list');
  const uploadStatusSubtitle = document.getElementById('upload-status-subtitle');

  // DOM Elements - Success
  const successSummaryText = document.getElementById('success-summary-text');
  const openMetromateWebBtn = document.getElementById('open-metromate-web-btn');
  const uploadMoreBtn = document.getElementById('upload-more-btn');

  // DOM Elements - Settings Modal
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
  const settingsWebUrl = document.getElementById('settings-web-url');
  const settingsApiUrl = document.getElementById('settings-api-url');
  const settingsAuthToken = document.getElementById('settings-auth-token');
  const testConnectionBtn = document.getElementById('test-connection-btn');
  const testConnectionStatus = document.getElementById('test-connection-status');
  const saveSettingsBtn = document.getElementById('save-settings-btn');

  // Helper: Format byte size into human readable string (e.g. 24.5 MB)
  function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const formatted = (bytes / Math.pow(k, i)).toFixed(1);
    return `${formatted} ${sizes[i]}`;
  }

  // Helper: Format audio time in seconds (e.g. 74 -> "1:14")
  function formatAudioTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity || seconds === null || seconds === undefined) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  // Multi-Step Wizard Navigation Controller
  function showStep(step) {
    // Hide all views first
    uploadCard?.classList.add('hidden');
    selectedStemsCard?.classList.add('hidden');
    projectSelectionCard?.classList.add('hidden');
    uploadProgressCard?.classList.add('hidden');
    uploadSuccessCard?.classList.add('hidden');

    // Update wizard stepper
    if (wizardStepper) {
      if (step === 'dropzone' || step === 'success') {
        wizardStepper.classList.add('hidden');
      } else {
        wizardStepper.classList.remove('hidden');
        const indicators = wizardStepper.querySelectorAll('.step-indicator');
        indicators.forEach((ind) => {
          const stepNum = parseInt(ind.getAttribute('data-step'), 10);
          ind.classList.remove('active', 'completed');

          if (step === 'stems') {
            if (stepNum === 1) ind.classList.add('active');
          } else if (step === 'projects') {
            if (stepNum === 1) ind.classList.add('completed');
            if (stepNum === 2) ind.classList.add('active');
          } else if (step === 'uploading') {
            if (stepNum < 3) ind.classList.add('completed');
            if (stepNum === 3) ind.classList.add('active');
          }
        });
      }
    }

    if (step === 'dropzone') {
      uploadCard?.classList.remove('hidden');
    } else if (step === 'stems') {
      selectedStemsCard?.classList.remove('hidden');
    } else if (step === 'projects') {
      projectSelectionCard?.classList.remove('hidden');
      loadProjects();
    } else if (step === 'uploading') {
      uploadProgressCard?.classList.remove('hidden');
    } else if (step === 'success') {
      uploadSuccessCard?.classList.remove('hidden');
    }
  }

  // Web Audio Playback Engine
  class StemAudioPlayer {
    constructor() {
      this.ctx = null;
      this.source = null;
      this.audioBuffer = null;
      this.startTime = 0;
      this.pauseOffset = 0;
      this.isPlaying = false;
      this.currentIndex = null;
      this.intervalId = null;
    }

    getAudioContext() {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    stop() {
      if (this.source) {
        try {
          this.source.onended = null;
          this.source.stop();
          this.source.disconnect();
        } catch (e) {}
        this.source = null;
      }
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      this.isPlaying = false;
      this.pauseOffset = 0;
      this.currentIndex = null;
    }

    async loadAndPlay(arrayBuffer, index, onProgress, onEnded, onLoaded) {
      this.stop();
      this.currentIndex = index;
      const ctx = this.getAudioContext();

      this.audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      if (onLoaded) onLoaded(this.audioBuffer.duration);

      this.playFrom(0, onProgress, onEnded);
    }

    playFrom(offsetSeconds, onProgress, onEnded) {
      if (!this.audioBuffer) return;
      const ctx = this.getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      if (this.source) {
        try {
          this.source.onended = null;
          this.source.stop();
          this.source.disconnect();
        } catch (e) {}
      }

      const duration = this.audioBuffer.duration;
      const safeOffset = Math.max(0, Math.min(offsetSeconds, duration));

      this.source = ctx.createBufferSource();
      this.source.buffer = this.audioBuffer;
      this.source.connect(ctx.destination);

      this.startTime = ctx.currentTime - safeOffset;
      this.pauseOffset = safeOffset;
      this.isPlaying = true;

      this.source.onended = () => {
        if (this.isPlaying) {
          const elapsed = ctx.currentTime - this.startTime;
          if (elapsed >= duration - 0.15) {
            this.stop();
            if (onEnded) onEnded();
          }
        }
      };

      this.source.start(0, safeOffset);

      if (this.intervalId) clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        if (!this.isPlaying) return;
        const current = ctx.currentTime - this.startTime;
        if (current <= duration) {
          if (onProgress) onProgress(current, duration);
        }
      }, 50);
    }

    pause() {
      if (!this.isPlaying) return;
      const ctx = this.getAudioContext();
      this.pauseOffset = ctx.currentTime - this.startTime;
      this.isPlaying = false;
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.source) {
        try {
          this.source.onended = null;
          this.source.stop();
          this.source.disconnect();
        } catch (e) {}
        this.source = null;
      }
    }

    resume(onProgress, onEnded) {
      if (this.isPlaying || !this.audioBuffer) return;
      this.playFrom(this.pauseOffset, onProgress, onEnded);
    }

    seek(targetSeconds, onProgress, onEnded) {
      if (!this.audioBuffer) return;
      if (this.isPlaying) {
        this.playFrom(targetSeconds, onProgress, onEnded);
      } else {
        this.pauseOffset = targetSeconds;
        if (onProgress) onProgress(targetSeconds, this.audioBuffer.duration);
      }
    }
  }

  const stemPlayer = new StemAudioPlayer();

  // Play icon SVG
  function getPlayIconSvg() {
    return `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6 3 20 12 6 21 6 3"></polygon>
      </svg>
    `;
  }

  // Pause icon SVG
  function getPauseIconSvg() {
    return `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
    `;
  }

  // Toggle audio playback for a stem
  async function togglePlayStem(stem, index) {
    const playBtn = document.querySelector(`.stem-item[data-index="${index}"] .stem-play-btn`);
    const itemEl = document.querySelector(`.stem-item[data-index="${index}"]`);

    if (stemPlayer.currentIndex === index && stemPlayer.audioBuffer) {
      if (stemPlayer.isPlaying) {
        stemPlayer.pause();
        if (playBtn) {
          playBtn.classList.remove('playing');
          playBtn.innerHTML = getPlayIconSvg();
        }
      } else {
        if (playBtn) {
          playBtn.classList.add('playing');
          playBtn.innerHTML = getPauseIconSvg();
        }
        stemPlayer.resume(
          (current, duration) => updatePlayerProgressUI(index, current, duration),
          () => resetPlayerUI(index)
        );
      }
      return;
    }

    if (stemPlayer.currentIndex !== null) {
      resetPlayerUI(stemPlayer.currentIndex);
    }

    if (playBtn) {
      playBtn.classList.add('playing');
      playBtn.innerHTML = getPauseIconSvg();
    }

    try {
      let buffer = null;

      if (stem.rawFile && typeof stem.rawFile.arrayBuffer === 'function') {
        buffer = await stem.rawFile.arrayBuffer();
      } else if (stem.path && window.electronAPI && typeof window.electronAPI.readStemBuffer === 'function') {
        buffer = await window.electronAPI.readStemBuffer(stem.path);
      }

      if (!buffer) {
        console.warn('Could not read audio data for playback');
        resetPlayerUI(index);
        return;
      }

      await stemPlayer.loadAndPlay(
        buffer,
        index,
        (current, duration) => updatePlayerProgressUI(index, current, duration),
        () => resetPlayerUI(index),
        (duration) => {
          if (itemEl) {
            const totalTimeEl = itemEl.querySelector('.player-time-total');
            if (totalTimeEl) totalTimeEl.textContent = formatAudioTime(duration);
          }
        }
      );
    } catch (err) {
      console.error('Playback error:', err);
      resetPlayerUI(index);
    }
  }

  function updatePlayerProgressUI(index, currentTime, duration) {
    const itemEl = document.querySelector(`.stem-item[data-index="${index}"]`);
    if (itemEl) {
      const progressEl = itemEl.querySelector('.player-progress');
      const currentTimeEl = itemEl.querySelector('.player-time-current');
      const percent = duration > 0 ? (currentTime / duration) * 100 : 0;

      if (progressEl) progressEl.style.width = `${Math.min(100, percent)}%`;
      if (currentTimeEl) currentTimeEl.textContent = formatAudioTime(currentTime);
    }
  }

  function resetPlayerUI(index) {
    const itemEl = document.querySelector(`.stem-item[data-index="${index}"]`);
    if (itemEl) {
      const playBtn = itemEl.querySelector('.stem-play-btn');
      if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = getPlayIconSvg();
      }
      const progressEl = itemEl.querySelector('.player-progress');
      if (progressEl) progressEl.style.width = '0%';
      const currentTimeEl = itemEl.querySelector('.player-time-current');
      if (currentTimeEl) currentTimeEl.textContent = '0:00';
    }
  }

  // Helper: Validate file extension
  function isValidAudioFile(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  // Helper: Get clean extension string without dot (e.g. WAV)
  function getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toUpperCase() : '';
  }

  // Helper: Extract BPM from filename pattern
  function extractBpmFromFilename(filename) {
    if (!filename) return null;
    const match = filename.match(/(?:^|[_\-\s])(\d{2,3})\s*(?:bpm)?(?:[_\-\s]|\.|$)/i);
    if (match) {
      const val = parseInt(match[1], 10);
      if (val >= 60 && val <= 220) return val;
    }
    return null;
  }

  // Helper: Extract Key from filename pattern
  function extractKeyFromFilename(filename) {
    if (!filename) return null;
    const clean = filename.replace(/\.[^/.]+$/, '');
    const keyRegex = /(?:^|[_\-\s\[(])([A-G][#b]?)\s*(maj|major|min|minor|m|M)?(?:[_\-\s\])]|$)/i;
    const match = clean.match(keyRegex);
    if (match) {
      let root = match[1].toUpperCase();
      if (root.length > 1) {
        root = root[0] + root[1].toLowerCase();
      }
      const modeRaw = (match[2] || '').toLowerCase();
      let mode = 'Major';
      if (modeRaw === 'm' || modeRaw === 'min' || modeRaw === 'minor') {
        mode = 'Minor';
      }
      return `${root} ${mode}`;
    }
    return null;
  }

  // Pure Web Audio API BPM Detection Engine
  async function detectBpmFromAudioBuffer(arrayBuffer) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      const audioCtx = new AudioContextClass();

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const duration = Math.min(audioBuffer.duration, 30);
      const sampleRate = audioBuffer.sampleRate;

      const offlineCtx = new OfflineAudioContext(1, Math.floor(duration * sampleRate), sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      const filter = offlineCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 150;

      source.connect(filter);
      filter.connect(offlineCtx.destination);
      source.start(0);

      const filteredBuffer = await offlineCtx.startRendering();
      const channelData = filteredBuffer.getChannelData(0);

      let maxVal = 0;
      for (let i = 0; i < channelData.length; i++) {
        const absVal = Math.abs(channelData[i]);
        if (absVal > maxVal) maxVal = absVal;
      }
      if (maxVal === 0) return null;

      const threshold = maxVal * 0.45;
      const step = Math.floor(sampleRate / 100);
      const peaks = [];

      for (let i = 0; i < channelData.length; i += step) {
        if (Math.abs(channelData[i]) > threshold) {
          let peakIdx = i;
          let peakVal = Math.abs(channelData[i]);
          for (let j = i; j < Math.min(i + step, channelData.length); j++) {
            if (Math.abs(channelData[j]) > peakVal) {
              peakVal = Math.abs(channelData[j]);
              peakIdx = j;
            }
          }
          peaks.push(peakIdx);
          i += Math.floor(sampleRate * 0.2);
        }
      }

      if (peaks.length < 4) return null;

      const intervals = [];
      for (let i = 0; i < peaks.length; i++) {
        for (let j = 1; j <= 4 && i + j < peaks.length; j++) {
          const interval = (peaks[i + j] - peaks[i]) / j;
          const bpm = (60 * sampleRate) / interval;
          if (bpm >= 60 && bpm <= 200) {
            intervals.push(Math.round(bpm));
          } else if (bpm > 200 && bpm <= 400) {
            intervals.push(Math.round(bpm / 2));
          }
        }
      }

      if (intervals.length === 0) return null;

      const counts = {};
      intervals.forEach((bpm) => {
        counts[bpm] = (counts[bpm] || 0) + 1;
      });

      let bestBpm = null;
      let maxCount = 0;
      for (const [bpm, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          bestBpm = parseInt(bpm, 10);
        }
      }

      return bestBpm;
    } catch (err) {
      console.warn('Could not auto-detect BPM from audio buffer:', err);
      return null;
    }
  }

  // Pure Web Audio API Key Detection Engine
  async function detectKeyFromAudioBuffer(arrayBuffer) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      const audioCtx = new AudioContextClass();

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;

      const analyzeLength = Math.min(channelData.length, Math.floor(sampleRate * 25));
      if (analyzeLength === 0) return null;

      const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
      const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

      const chroma = new Float64Array(12);
      const stride = 4;
      const effectiveLength = Math.floor(analyzeLength / stride);
      const effectiveSampleRate = sampleRate / stride;

      const downsampled = new Float32Array(effectiveLength);
      for (let i = 0; i < effectiveLength; i++) {
        downsampled[i] = channelData[i * stride];
      }

      for (let semitone = 0; semitone < 12; semitone++) {
        let semitoneEnergy = 0;
        for (let octave = 2; octave <= 5; octave++) {
          const midiNote = 12 * (octave + 1) + semitone;
          const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
          const omega = (2 * Math.PI * freq) / effectiveSampleRate;
          let real = 0;
          let imag = 0;

          const blockSize = Math.min(effectiveLength, 8192);
          for (let n = 0; n < blockSize; n++) {
            const val = downsampled[n];
            real += val * Math.cos(omega * n);
            imag += val * Math.sin(omega * n);
          }

          semitoneEnergy += Math.sqrt(real * real + imag * imag);
        }
        chroma[semitone] = semitoneEnergy;
      }

      function correlate(vecA, vecB) {
        let meanA = 0;
        let meanB = 0;
        for (let i = 0; i < 12; i++) {
          meanA += vecA[i];
          meanB += vecB[i];
        }
        meanA /= 12;
        meanB /= 12;

        let num = 0;
        let denA = 0;
        let denB = 0;
        for (let i = 0; i < 12; i++) {
          const diffA = vecA[i] - meanA;
          const diffB = vecB[i] - meanB;
          num += diffA * diffB;
          denA += diffA * diffA;
          denB += diffB * diffB;
        }

        const denom = Math.sqrt(denA * denB);
        return denom === 0 ? 0 : num / denom;
      }

      let bestKey = null;
      let maxCorrelation = -Infinity;

      for (let root = 0; root < 12; root++) {
        const rotatedChroma = [];
        for (let i = 0; i < 12; i++) {
          rotatedChroma.push(chroma[(root + i) % 12]);
        }

        const majorCorr = correlate(rotatedChroma, MAJOR_PROFILE);
        if (majorCorr > maxCorrelation) {
          maxCorrelation = majorCorr;
          bestKey = `${PITCH_NAMES[root]} Major`;
        }

        const minorCorr = correlate(rotatedChroma, MINOR_PROFILE);
        if (minorCorr > maxCorrelation) {
          maxCorrelation = minorCorr;
          bestKey = `${PITCH_NAMES[root]} Minor`;
        }
      }

      return bestKey;
    } catch (err) {
      console.warn('Could not auto-detect Key from audio buffer:', err);
      return null;
    }
  }

  // Asynchronously calculate BPM for a stem
  async function calculateBpmForStem(stem, index) {
    try {
      let buffer = null;

      if (stem.rawFile && typeof stem.rawFile.arrayBuffer === 'function') {
        buffer = await stem.rawFile.arrayBuffer();
      } else if (stem.path && window.electronAPI && typeof window.electronAPI.readStemBuffer === 'function') {
        buffer = await window.electronAPI.readStemBuffer(stem.path);
      }

      if (buffer) {
        const detectedBpm = await detectBpmFromAudioBuffer(buffer);
        if (detectedBpm) {
          stem.bpm = detectedBpm;
        }
      }
    } catch (e) {
      console.error('Error calculating BPM for stem:', stem.name, e);
    } finally {
      stem.isDetectingBpm = false;

      const itemEl = document.querySelector(`.stem-item[data-index="${index}"]`);
      if (itemEl) {
        const bpmBadge = itemEl.querySelector('.stem-bpm-badge');
        if (bpmBadge) {
          if (stem.bpm) {
            bpmBadge.className = 'stem-bpm-badge';
            bpmBadge.textContent = `🎵 ${stem.bpm} BPM`;
          } else {
            bpmBadge.remove();
          }
        } else if (stem.bpm) {
          const badge = document.createElement('span');
          badge.className = 'stem-bpm-badge';
          badge.textContent = `🎵 ${stem.bpm} BPM`;
          const stemInfo = itemEl.querySelector('.stem-info');
          if (stemInfo) stemInfo.appendChild(badge);
        }

        const bpmInput = itemEl.querySelector('.stem-bpm-input');
        if (bpmInput && !bpmInput.matches(':focus') && stem.bpm) {
          bpmInput.value = stem.bpm;
        }
      }
    }
  }

  // Asynchronously calculate Key for a stem
  async function calculateKeyForStem(stem, index) {
    try {
      let buffer = null;

      if (stem.rawFile && typeof stem.rawFile.arrayBuffer === 'function') {
        buffer = await stem.rawFile.arrayBuffer();
      } else if (stem.path && window.electronAPI && typeof window.electronAPI.readStemBuffer === 'function') {
        buffer = await window.electronAPI.readStemBuffer(stem.path);
      }

      if (buffer) {
        const detectedKey = await detectKeyFromAudioBuffer(buffer);
        if (detectedKey) {
          stem.key = detectedKey;
        }
      }
    } catch (e) {
      console.error('Error calculating Key for stem:', stem.name, e);
    } finally {
      stem.isDetectingKey = false;

      const itemEl = document.querySelector(`.stem-item[data-index="${index}"]`);
      if (itemEl) {
        const keyBadge = itemEl.querySelector('.stem-key-badge');
        if (keyBadge) {
          if (stem.key) {
            keyBadge.className = 'stem-key-badge';
            keyBadge.textContent = `🎹 ${stem.key}`;
          } else {
            keyBadge.remove();
          }
        } else if (stem.key) {
          const badge = document.createElement('span');
          badge.className = 'stem-key-badge';
          badge.textContent = `🎹 ${stem.key}`;
          const stemInfo = itemEl.querySelector('.stem-info');
          if (stemInfo) stemInfo.appendChild(badge);
        }

        const keyInput = itemEl.querySelector('.stem-key-input');
        if (keyInput && !keyInput.matches(':focus') && stem.key) {
          keyInput.value = stem.key;
        }
      }
    }
  }

  // Render the selected stems UI list (STEP 1)
  function renderStemsList() {
    if (selectedStems.length === 0) {
      showStep('dropzone');
      return;
    }

    showStep('stems');

    if (stemsCountBadge) {
      const count = selectedStems.length;
      stemsCountBadge.textContent = `${count} stem${count === 1 ? '' : 's'}`;
    }

    if (!stemsList) return;
    stemsList.innerHTML = '';

    selectedStems.forEach((stem, index) => {
      const stemItem = document.createElement('div');
      stemItem.className = 'stem-item';
      stemItem.setAttribute('data-index', index);

      // 1. Header Row
      const headerRow = document.createElement('div');
      headerRow.className = 'stem-header-row';

      const stemInfo = document.createElement('div');
      stemInfo.className = 'stem-info';

      const playBtn = document.createElement('button');
      playBtn.className = 'stem-play-btn';
      playBtn.title = `Play ${stem.name}`;
      playBtn.setAttribute('aria-label', `Play ${stem.name}`);
      playBtn.innerHTML = (stemPlayer.currentIndex === index && stemPlayer.isPlaying)
        ? getPauseIconSvg()
        : getPlayIconSvg();

      if (stemPlayer.currentIndex === index && stemPlayer.isPlaying) {
        playBtn.classList.add('playing');
      }

      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayStem(stem, index);
      });

      const stemName = document.createElement('span');
      stemName.className = 'stem-name';
      stemName.textContent = stem.name;
      stemName.title = stem.path || stem.name;

      const stemBadge = document.createElement('span');
      stemBadge.className = 'stem-extension-badge';
      stemBadge.textContent = getFileExtension(stem.name);

      stemInfo.appendChild(playBtn);
      stemInfo.appendChild(stemName);
      stemInfo.appendChild(stemBadge);

      if (stem.isDetectingBpm) {
        const bpmBadge = document.createElement('span');
        bpmBadge.className = 'stem-bpm-badge loading';
        bpmBadge.textContent = '⚡ BPM...';
        stemInfo.appendChild(bpmBadge);
      } else if (stem.bpm) {
        const bpmBadge = document.createElement('span');
        bpmBadge.className = 'stem-bpm-badge';
        bpmBadge.textContent = `🎵 ${stem.bpm} BPM`;
        stemInfo.appendChild(bpmBadge);
      }

      if (stem.isDetectingKey) {
        const keyBadge = document.createElement('span');
        keyBadge.className = 'stem-key-badge loading';
        keyBadge.textContent = '⚡ Key...';
        stemInfo.appendChild(keyBadge);
      } else if (stem.key) {
        const keyBadge = document.createElement('span');
        keyBadge.className = 'stem-key-badge';
        keyBadge.textContent = `🎹 ${stem.key}`;
        stemInfo.appendChild(keyBadge);
      }

      const stemActions = document.createElement('div');
      stemActions.className = 'stem-actions';

      const stemSize = document.createElement('span');
      stemSize.className = 'stem-size';
      stemSize.textContent = formatFileSize(stem.size);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'stem-remove-btn';
      removeBtn.setAttribute('aria-label', `Remove ${stem.name}`);
      removeBtn.title = `Remove ${stem.name}`;
      removeBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;

      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeStemByIndex(index);
      });

      stemActions.appendChild(stemSize);
      stemActions.appendChild(removeBtn);

      headerRow.appendChild(stemInfo);
      headerRow.appendChild(stemActions);

      // 2. Audio Player Bar
      const playerBar = document.createElement('div');
      playerBar.className = 'stem-player-bar';

      const currentTimeEl = document.createElement('span');
      currentTimeEl.className = 'player-time player-time-current';
      currentTimeEl.textContent = '0:00';

      const playerTrack = document.createElement('div');
      playerTrack.className = 'player-track';
      playerTrack.title = 'Click to seek';

      const playerProgress = document.createElement('div');
      playerProgress.className = 'player-progress';
      playerTrack.appendChild(playerProgress);

      playerTrack.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rect = playerTrack.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

        if (stemPlayer.currentIndex === index && stemPlayer.audioBuffer) {
          const targetSeconds = pos * stemPlayer.audioBuffer.duration;
          stemPlayer.seek(
            targetSeconds,
            (current, duration) => updatePlayerProgressUI(index, current, duration),
            () => resetPlayerUI(index)
          );
        } else {
          await togglePlayStem(stem, index);
          if (stemPlayer.audioBuffer) {
            const targetSeconds = pos * stemPlayer.audioBuffer.duration;
            stemPlayer.seek(
              targetSeconds,
              (current, duration) => updatePlayerProgressUI(index, current, duration),
              () => resetPlayerUI(index)
            );
          }
        }
      });

      const totalTimeEl = document.createElement('span');
      totalTimeEl.className = 'player-time player-time-total';
      totalTimeEl.textContent = '--:--';

      playerBar.appendChild(currentTimeEl);
      playerBar.appendChild(playerTrack);
      playerBar.appendChild(totalTimeEl);

      // 3. Fields Grid
      const fieldsGrid = document.createElement('div');
      fieldsGrid.className = 'stem-fields-grid';

      // 3a. Title field
      const titleGroup = document.createElement('div');
      titleGroup.className = 'stem-field-group';

      const titleLabel = document.createElement('label');
      titleLabel.className = 'stem-field-label';
      titleLabel.textContent = 'Stem Title';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'stem-input stem-title-input';
      titleInput.placeholder = 'e.g. Lead Vocals, Kick, Bassline';
      titleInput.value = stem.title || '';

      titleInput.addEventListener('input', (e) => {
        stem.title = e.target.value;
      });

      titleGroup.appendChild(titleLabel);
      titleGroup.appendChild(titleInput);

      // 3b. BPM field
      const bpmGroup = document.createElement('div');
      bpmGroup.className = 'stem-field-group';

      const bpmLabel = document.createElement('label');
      bpmLabel.className = 'stem-field-label';
      bpmLabel.innerHTML = `BPM <span class="label-tag">⚡ Auto</span>`;

      const bpmInput = document.createElement('input');
      bpmInput.type = 'number';
      bpmInput.min = '40';
      bpmInput.max = '280';
      bpmInput.step = '1';
      bpmInput.className = 'stem-input stem-bpm-input';
      bpmInput.placeholder = 'e.g. 120';
      bpmInput.value = stem.bpm || '';

      bpmInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        stem.bpm = !isNaN(val) ? val : null;
        const bpmBadge = stemItem ? stemItem.querySelector('.stem-bpm-badge') : null;
        if (bpmBadge && stem.bpm) {
          bpmBadge.textContent = `🎵 ${stem.bpm} BPM`;
        }
      });

      bpmGroup.appendChild(bpmLabel);
      bpmGroup.appendChild(bpmInput);

      // 3c. Key field
      const keyGroup = document.createElement('div');
      keyGroup.className = 'stem-field-group';

      const keyLabel = document.createElement('label');
      keyLabel.className = 'stem-field-label';
      keyLabel.innerHTML = `Key <span class="label-tag">⚡ Auto</span>`;

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'stem-input stem-key-input';
      keyInput.placeholder = 'e.g. C Major, A Minor';
      keyInput.value = stem.key || '';

      keyInput.addEventListener('input', (e) => {
        stem.key = e.target.value.trim();
        const keyBadge = stemItem ? stemItem.querySelector('.stem-key-badge') : null;
        if (keyBadge && stem.key) {
          keyBadge.textContent = `🎹 ${stem.key}`;
        }
      });

      keyGroup.appendChild(keyLabel);
      keyGroup.appendChild(keyInput);

      // 3d. Description field
      const descGroup = document.createElement('div');
      descGroup.className = 'stem-field-group stem-field-group-desc';

      const descLabel = document.createElement('label');
      descLabel.className = 'stem-field-label';
      descLabel.textContent = 'Description / Notes';

      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'stem-input stem-desc-input';
      descInput.placeholder = 'e.g. 120 BPM, wet reverb FX, dry stem';
      descInput.value = stem.description || '';

      descInput.addEventListener('input', (e) => {
        stem.description = e.target.value;
      });

      descGroup.appendChild(descLabel);
      descGroup.appendChild(descInput);

      fieldsGrid.appendChild(titleGroup);
      fieldsGrid.appendChild(bpmGroup);
      fieldsGrid.appendChild(keyGroup);
      fieldsGrid.appendChild(descGroup);

      stemItem.appendChild(headerRow);
      stemItem.appendChild(playerBar);
      stemItem.appendChild(fieldsGrid);

      stemsList.appendChild(stemItem);
    });
  }

  // Remove a single stem from UI state
  function removeStemByIndex(index) {
    if (stemPlayer.currentIndex === index) {
      stemPlayer.stop();
    } else if (stemPlayer.currentIndex !== null && stemPlayer.currentIndex > index) {
      stemPlayer.currentIndex--;
    }

    if (index >= 0 && index < selectedStems.length) {
      selectedStems.splice(index, 1);
      renderStemsList();
    }
  }

  // Add new files to state with validation, default metadata, deduplication & automatic BPM / Key detection
  function addFilesToSelection(newFiles) {
    if (!newFiles || !Array.isArray(newFiles) || newFiles.length === 0) {
      return;
    }

    const newlyAddedStems = [];

    newFiles.forEach((file) => {
      if (isValidAudioFile(file.name)) {
        const exists = selectedStems.some((s) => (s.path && file.path ? s.path === file.path : s.name === file.name));
        if (!exists) {
          const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
          const filenameBpm = extractBpmFromFilename(file.name);
          const filenameKey = extractKeyFromFilename(file.name);

          const newStem = {
            ...file,
            title: file.title !== undefined ? file.title : defaultTitle,
            description: file.description !== undefined ? file.description : '',
            bpm: file.bpm !== undefined ? file.bpm : filenameBpm,
            key: file.key !== undefined ? file.key : filenameKey,
            isDetectingBpm: true,
            isDetectingKey: true,
          };

          selectedStems.push(newStem);
          newlyAddedStems.push(newStem);
        }
      }
    });

    if (newlyAddedStems.length > 0) {
      renderStemsList();

      newlyAddedStems.forEach((stem) => {
        const idx = selectedStems.indexOf(stem);
        calculateBpmForStem(stem, idx);
        calculateKeyForStem(stem, idx);
      });
    }
  }

  // Trigger native Electron stem file selection
  async function triggerStemFilePicker() {
    if (!window.electronAPI || typeof window.electronAPI.selectStemFiles !== 'function') {
      console.error('Electron API not available');
      return;
    }

    try {
      const files = await window.electronAPI.selectStemFiles();
      if (files && files.length > 0) {
        addFilesToSelection(files);
      }
    } catch (err) {
      console.error('Error selecting stem files:', err);
    }
  }

  // ==========================================
  // PROJECT SELECTION & UPLOAD LOGIC (STEP 2 & 3)
  // ==========================================

  // Load Projects from Metromate Express Backend
  async function loadProjects() {
    if (!projectsList) return;
    projectsList.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-secondary);">
        <span>Loading collaboration projects...</span>
      </div>
    `;

    try {
      const result = await window.electronAPI.getProjects({
        apiUrl: metromateApiUrl,
        token: metromateAuthToken,
        artistEmail: currentUser ? currentUser.email : undefined,
      });

      if (connectionStatusBadge && connectionStatusText) {
        if (result.isOnline) {
          connectionStatusBadge.className = 'connection-badge online';
          connectionStatusText.textContent = 'Backend Connected';
        } else {
          connectionStatusBadge.className = 'connection-badge offline';
          connectionStatusText.textContent = 'Offline / Demo Mode';
        }
      }

      metromateProjects = result.projects || [];
      renderProjectsList(projectSearchInput ? projectSearchInput.value : '');
    } catch (err) {
      console.error('Error fetching projects:', err);
      if (projectsList) {
        projectsList.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #ff8080;">
            <span>Could not load projects. Please verify your backend server in Settings.</span>
          </div>
        `;
      }
    }
  }

  // Render Projects Grid
  function renderProjectsList(filterText) {
    if (!projectsList) return;
    projectsList.innerHTML = '';

    // If not logged in, show a prompt banner to log in to access personal projects
    if (!currentUser) {
      const loginBanner = document.createElement('div');
      loginBanner.style.gridColumn = '1 / -1';
      loginBanner.style.padding = '0.75rem 1rem';
      loginBanner.style.backgroundColor = 'rgba(124, 92, 252, 0.1)';
      loginBanner.style.border = '1px dashed rgba(124, 92, 252, 0.35)';
      loginBanner.style.borderRadius = 'var(--radius-sm)';
      loginBanner.style.display = 'flex';
      loginBanner.style.alignItems = 'center';
      loginBanner.style.justifyContent = 'space-between';
      loginBanner.style.gap = '0.75rem';
      loginBanner.style.marginBottom = '0.5rem';

      loginBanner.innerHTML = `
        <span style="font-size: 0.82rem; color: #c0abff;">
          Log in with your Metromate account to load and select your personal projects.
        </span>
        <button id="project-prompt-login-btn" class="btn-primary" style="padding: 0.3rem 0.75rem; font-size: 0.75rem;">
          Log In Now
        </button>
      `;

      const promptBtn = loginBanner.querySelector('#project-prompt-login-btn');
      if (promptBtn) {
        promptBtn.addEventListener('click', () => {
          if (loginModal) {
            loginModal.classList.remove('hidden');
            if (loginEmail) loginEmail.focus();
          }
        });
      }

      projectsList.appendChild(loginBanner);
    } else {
      const userHeader = document.createElement('div');
      userHeader.style.gridColumn = '1 / -1';
      userHeader.style.fontSize = '0.82rem';
      userHeader.style.color = 'var(--text-secondary)';
      userHeader.style.marginBottom = '0.25rem';
      userHeader.textContent = `Showing projects for ${currentUser.name || currentUser.email}:`;
      projectsList.appendChild(userHeader);
    }

    const query = (filterText || '').trim().toLowerCase();
    const filtered = metromateProjects.filter((p) => {
      const title = (p.title || '').toLowerCase();
      const collabs = (p.collaborators || []).join(' ').toLowerCase();
      return title.includes(query) || collabs.includes(query);
    });

    if (filtered.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.gridColumn = '1 / -1';
      emptyState.style.textAlign = 'center';
      emptyState.style.padding = '2rem';
      emptyState.style.color = 'var(--text-secondary)';
      emptyState.textContent = 'No collaboration projects found.';
      projectsList.appendChild(emptyState);
      return;
    }

    filtered.forEach((proj) => {
      const card = document.createElement('div');
      card.className = `project-card ${selectedProjectId === proj.id ? 'selected' : ''}`;
      card.setAttribute('data-project-id', proj.id);

      const collabsList = Array.isArray(proj.collaborators) ? proj.collaborators.join(', ') : 'Solo Project';

      card.innerHTML = `
        <div class="project-card-header">
          <span class="project-card-title">${proj.title}</span>
          <span class="project-meta-badge">${proj.stemCount || 0} stems</span>
        </div>
        <div class="project-card-badges">
          ${proj.bpm ? `<span class="project-meta-badge bpm">🎵 ${proj.bpm} BPM</span>` : ''}
          ${proj.musicalKey ? `<span class="project-meta-badge key">🎹 ${proj.musicalKey}</span>` : ''}
        </div>
        <div class="project-collaborators">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>${collabsList}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        selectedProjectId = proj.id;
        document.querySelectorAll('.project-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');

        if (startUploadToProjectBtn) {
          startUploadToProjectBtn.removeAttribute('disabled');
          const count = selectedStems.length;
          startUploadToProjectBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
              <path d="M12 12v9"></path>
              <path d="m16 16-4-4-4 4"></path>
            </svg>
            <span>Upload ${count} Stem${count === 1 ? '' : 's'} to "${proj.title}"</span>
          `;
        }
      });

      projectsList.appendChild(card);
    });
  }

  // Execute Stem Upload Process (STEP 3)
  async function startStemUploads() {
    if (!selectedProjectId || selectedStems.length === 0) {
      alert('Please select a project first.');
      return;
    }

    // Stop playback if active
    stemPlayer.stop();

    showStep('uploading');

    // Populate uploading stems list
    if (uploadingStemsList) {
      uploadingStemsList.innerHTML = '';
      selectedStems.forEach((stem, idx) => {
        const item = document.createElement('div');
        item.className = 'uploading-stem-item';
        item.id = `upload-item-${idx}`;
        item.innerHTML = `
          <div class="uploading-stem-info">
            <span class="stem-name">${stem.title || stem.name}</span>
            <span class="stem-size">${formatFileSize(stem.size)}</span>
          </div>
          <span class="upload-status-tag waiting">Waiting</span>
        `;
        uploadingStemsList.appendChild(item);
      });
    }

    const totalStems = selectedStems.length;
    let uploadedCount = 0;

    for (let i = 0; i < totalStems; i++) {
      const stem = selectedStems[i];
      const itemEl = document.getElementById(`upload-item-${i}`);

      if (itemEl) {
        const statusTag = itemEl.querySelector('.upload-status-tag');
        if (statusTag) {
          statusTag.className = 'upload-status-tag uploading';
          statusTag.textContent = 'Uploading...';
        }
      }

      if (uploadStatusSubtitle) {
        uploadStatusSubtitle.textContent = `Streaming "${stem.title || stem.name}" (${formatFileSize(stem.size)}) to Metromate...`;
      }

      try {
        const res = await window.electronAPI.uploadStem({
          apiUrl: metromateApiUrl,
          token: metromateAuthToken,
          projectId: selectedProjectId,
          stemData: stem,
          filePath: stem.path,
          artistEmail: currentUser ? currentUser.email : undefined,
        });

        if (itemEl) {
          const statusTag = itemEl.querySelector('.upload-status-tag');
          if (statusTag) {
            if (res.success) {
              statusTag.className = 'upload-status-tag success';
              statusTag.textContent = 'Uploaded ✓';
            } else {
              statusTag.className = 'upload-status-tag error';
              statusTag.textContent = 'Failed ✕';
              console.warn('Upload failed for stem:', stem.name, res.error);
            }
          }
        }
      } catch (err) {
        console.error('Upload exception:', err);
        if (itemEl) {
          const statusTag = itemEl.querySelector('.upload-status-tag');
          if (statusTag) {
            statusTag.className = 'upload-status-tag error';
            statusTag.textContent = 'Failed ✕';
          }
        }
      }

      uploadedCount++;
      const percent = Math.round((uploadedCount / totalStems) * 100);

      if (overallProgressPercent) overallProgressPercent.textContent = `${percent}%`;
      if (overallProgressFill) overallProgressFill.style.width = `${percent}%`;
      if (overallProgressText) overallProgressText.textContent = `Uploaded ${uploadedCount} of ${totalStems} stems`;
    }

    // Finished uploading
    setTimeout(() => {
      const targetProj = metromateProjects.find((p) => p.id === selectedProjectId);
      const projName = targetProj ? targetProj.title : 'your Metromate project';

      if (successSummaryText) {
        successSummaryText.textContent = `All ${totalStems} stem${totalStems === 1 ? '' : 's'} were successfully saved to "${projName}" in the database.`;
      }

      showStep('success');
    }, 800);
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  if (startUploadBtn) {
    startUploadBtn.addEventListener('click', triggerStemFilePicker);
  }

  if (addMoreStemsBtn) {
    addMoreStemsBtn.addEventListener('click', triggerStemFilePicker);
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      stemPlayer.stop();
      selectedStems = [];
      showStep('dropzone');
    });
  }

  // "Continue to Project Selection"
  if (continueToProjectsBtn) {
    continueToProjectsBtn.addEventListener('click', () => {
      showStep('projects');
    });
  }

  // "Back to Stems"
  if (backToStemsBtn) {
    backToStemsBtn.addEventListener('click', () => {
      showStep('stems');
    });
  }

  // Search project filter
  if (projectSearchInput) {
    projectSearchInput.addEventListener('input', (e) => {
      renderProjectsList(e.target.value);
    });
  }

  // Refresh projects
  if (refreshProjectsBtn) {
    refreshProjectsBtn.addEventListener('click', () => {
      loadProjects();
    });
  }

  // "Upload Stems to Project"
  if (startUploadToProjectBtn) {
    startUploadToProjectBtn.addEventListener('click', startStemUploads);
  }

  // Open in Metromate Web
  if (openMetromateWebBtn) {
    openMetromateWebBtn.addEventListener('click', () => {
      const baseUrl = (metromateWebUrl || 'http://localhost:3000').replace(/\/+$/, '');
      const targetProj = metromateProjects.find((p) => p.id === selectedProjectId);
      let projectPath = selectedProjectId ? `/projects/solo/${selectedProjectId}` : '/projects';

      if (targetProj && targetProj.projectType && targetProj.projectType.toLowerCase() === 'collab') {
        projectPath = `/projects/collab/${selectedProjectId}`;
      } else if (selectedProjectId) {
        projectPath = `/projects/solo/${selectedProjectId}`;
      }

      const fullUrl = `${baseUrl}${projectPath}`;
      window.electronAPI.openExternal(fullUrl);
    });
  }

  // Upload More Stems
  if (uploadMoreBtn) {
    uploadMoreBtn.addEventListener('click', () => {
      selectedStems = [];
      selectedProjectId = null;
      showStep('dropzone');
    });
  }

  // ==========================================
  // USER AUTHENTICATION CONTROLLER
  // ==========================================

  function updateUserAuthUI() {
    if (currentUser) {
      if (openLoginBtn) openLoginBtn.classList.add('hidden');
      if (userProfileWidget) userProfileWidget.classList.remove('hidden');

      const initial = (currentUser.name || currentUser.email || 'A').charAt(0).toUpperCase();
      if (userAvatarInitial) userAvatarInitial.textContent = initial;
      if (userDisplayName) userDisplayName.textContent = currentUser.name || currentUser.email || 'Artist';
    } else {
      if (openLoginBtn) openLoginBtn.classList.remove('hidden');
      if (userProfileWidget) userProfileWidget.classList.add('hidden');
    }
  }

  // Open Login Modal
  if (openLoginBtn && loginModal) {
    openLoginBtn.addEventListener('click', () => {
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      loginModal.classList.remove('hidden');
      if (loginEmail) loginEmail.focus();
    });
  }

  // Close Login Modal
  if (closeLoginModalBtn && loginModal) {
    closeLoginModalBtn.addEventListener('click', () => {
      loginModal.classList.add('hidden');
    });
  }

  // Handle Login Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = loginEmail ? loginEmail.value.trim() : '';
      const password = loginPassword ? loginPassword.value : '';

      if (!email || !password) {
        if (loginErrorMsg) {
          loginErrorMsg.textContent = 'Please enter both email and password.';
          loginErrorMsg.classList.remove('hidden');
        }
        return;
      }

      if (submitLoginBtn) {
        submitLoginBtn.setAttribute('disabled', 'true');
        submitLoginBtn.innerHTML = '<span>Signing in...</span>';
      }
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

      try {
        const res = await window.electronAPI.login({
          apiUrl: metromateApiUrl,
          email,
          password,
        });

        if (res.success) {
          currentUser = res.user;
          metromateAuthToken = res.token || '';

          localStorage.setItem('metromate_user', JSON.stringify(currentUser));
          localStorage.setItem('metromate_auth_token', metromateAuthToken);

          updateUserAuthUI();
          if (loginModal) loginModal.classList.add('hidden');

          // If on projects step, refresh projects with user authentication
          if (projectSelectionCard && !projectSelectionCard.classList.contains('hidden')) {
            loadProjects();
          }
        } else {
          if (loginErrorMsg) {
            loginErrorMsg.textContent = res.error || 'Invalid email or password.';
            loginErrorMsg.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (loginErrorMsg) {
          loginErrorMsg.textContent = 'Login error: ' + (err.message || 'Server error');
          loginErrorMsg.classList.remove('hidden');
        }
      } finally {
        if (submitLoginBtn) {
          submitLoginBtn.removeAttribute('disabled');
          submitLoginBtn.innerHTML = '<span>Sign In to Metromate</span>';
        }
      }
    });
  }

  // Handle Logout
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      currentUser = null;
      metromateAuthToken = '';

      localStorage.removeItem('metromate_user');
      localStorage.removeItem('metromate_auth_token');

      updateUserAuthUI();

      // If on projects step, reload projects
      if (projectSelectionCard && !projectSelectionCard.classList.contains('hidden')) {
        loadProjects();
      }
    });
  }

  // Initialize Auth UI on startup
  updateUserAuthUI();

  // ==========================================
  // SETTINGS MODAL LISTENERS
  // ==========================================

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      if (settingsWebUrl) settingsWebUrl.value = metromateWebUrl;
      if (settingsApiUrl) settingsApiUrl.value = metromateApiUrl;
      if (settingsAuthToken) settingsAuthToken.value = metromateAuthToken;
      if (testConnectionStatus) testConnectionStatus.classList.add('hidden');
      settingsModal.classList.remove('hidden');
    });
  }

  if (closeSettingsModalBtn && settingsModal) {
    closeSettingsModalBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }

  function cleanApiUrl(input) {
    let url = (input || 'http://localhost:5050').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    return url.replace(/\/\/0\.0\.0\.0(?::|$)/, (m) => m.replace('0.0.0.0', '127.0.0.1'));
  }

  if (testConnectionBtn) {
    testConnectionBtn.addEventListener('click', async () => {
      let rawUrl = (settingsApiUrl ? settingsApiUrl.value : metromateApiUrl).trim();
      const url = cleanApiUrl(rawUrl);
      if (settingsApiUrl && rawUrl !== url) {
        settingsApiUrl.value = url;
      }
      const token = (settingsAuthToken ? settingsAuthToken.value : '').trim();

      if (testConnectionStatus) {
        testConnectionStatus.className = 'test-status';
        testConnectionStatus.classList.remove('hidden');
        testConnectionStatus.textContent = 'Testing connection to ' + url + '...';
      }

      const res = await window.electronAPI.getProjects({
        apiUrl: url,
        token,
        artistEmail: currentUser ? currentUser.email : undefined,
      });

      if (testConnectionStatus) {
        if (res.isOnline) {
          testConnectionStatus.className = 'test-status success';
          testConnectionStatus.textContent = `✓ Successfully connected to Metromate server! (${(res.projects || []).length} projects found)`;
        } else {
          testConnectionStatus.className = 'test-status error';
          testConnectionStatus.textContent = `✕ ${res.error || `Could not reach server at ${url}. Make sure your Express backend is running.`}`;
        }
      }
    });
  }

  if (saveSettingsBtn && settingsModal) {
    saveSettingsBtn.addEventListener('click', () => {
      if (settingsWebUrl) {
        metromateWebUrl = cleanApiUrl(settingsWebUrl.value || 'http://localhost:3000');
        settingsWebUrl.value = metromateWebUrl;
        localStorage.setItem('metromate_web_url', metromateWebUrl);
      }
      if (settingsApiUrl) {
        metromateApiUrl = cleanApiUrl(settingsApiUrl.value);
        settingsApiUrl.value = metromateApiUrl;
        localStorage.setItem('metromate_api_url', metromateApiUrl);
      }
      if (settingsAuthToken) {
        metromateAuthToken = settingsAuthToken.value.trim();
        localStorage.setItem('metromate_auth_token', metromateAuthToken);
      }

      settingsModal.classList.add('hidden');
      loadProjects();
    });
  }

  // Drag and Drop support
  if (dragDropZone) {
    dragDropZone.addEventListener('click', triggerStemFilePicker);

    dragDropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerStemFilePicker();
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dragDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'dragend'].forEach((eventName) => {
      dragDropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDropZone.classList.remove('drag-over');
      });
    });

    dragDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDropZone.classList.remove('drag-over');

      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        const droppedFiles = Array.from(dt.files);
        const validFiles = [];
        let hasInvalidFiles = false;

        droppedFiles.forEach((f) => {
          if (isValidAudioFile(f.name)) {
            validFiles.push({
              name: f.name,
              path: f.path || f.name,
              rawFile: f,
              extension: '.' + f.name.split('.').pop().toLowerCase(),
              size: f.size || 0,
            });
          } else {
            hasInvalidFiles = true;
          }
        });

        if (hasInvalidFiles && validFiles.length === 0) {
          alert('Only WAV, MP3, FLAC and AIFF files are supported.');
        } else if (validFiles.length > 0) {
          addFilesToSelection(validFiles);
        }
      }
    });
  }
}

// Ensure initStemUploader runs regardless of whether DOM is loading or already parsed
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStemUploader);
} else {
  initStemUploader();
}



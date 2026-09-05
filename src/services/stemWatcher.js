const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const chokidar = require('chokidar');

/**
 * Supported stem extensions (case-insensitive)
 */
const SUPPORTED_EXTENSIONS = new Set(['.wav', '.wave', '.mp3']);

/**
 * Ignored extensions and file patterns
 */
const IGNORED_EXTENSIONS = new Set(['.flp', '.mid', '.midi', '.txt', '.png', '.jpg', '.jpeg', '.pdf', '.zip', '.tmp']);

/**
 * StemWatcher
 * Monitors a designated folder for newly exported audio stems from FL Studio,
 * performs export completion checks, groups multi-stem exports together,
 * and emits notifications & events.
 */
class StemWatcher extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.watchFolder - Target directory path
   * @param {boolean} [options.isPaused=false] - Initial paused state
   * @param {number} [options.debounceDelay=1200] - Grouping debounce window in ms
   */
  constructor(options = {}) {
    super();
    this.watchFolder = options.watchFolder || '';
    this.isPaused = options.isPaused || false;
    this.debounceDelay = options.debounceDelay || 1200;

    this.watcher = null;
    this.status = 'idle'; // 'watching' | 'paused' | 'unavailable' | 'error' | 'idle'
    this.errorMessage = null;

    // Cache of processed files to prevent duplicate detections: Map<filePath, { size, mtimeMs } >
    this.processedFiles = new Map();

    // Files currently undergoing stability checks: Set<filePath>
    this.stabilizingFiles = new Set();

    // Pending batch queue of ready stems waiting to be emitted
    this.pendingBatch = [];
    this.debounceTimer = null;

    // Currently unreviewed stems list
    this.unreviewedStems = [];
  }

  /**
   * Validate if a file is an audio stem we care about
   * @param {string} filePath
   * @returns {boolean}
   */
  isTargetStem(filePath) {
    if (!filePath) return false;
    const baseName = path.basename(filePath);

    // Ignore hidden or temporary files (e.g. .DS_Store, ~$*, .* files)
    if (baseName.startsWith('.') || baseName.startsWith('~$') || baseName.endsWith('.tmp') || baseName.endsWith('.crdownload')) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) {
      return false;
    }

    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Ensure watch folder exists on filesystem
   * @param {string} folderPath
   * @returns {boolean}
   */
  ensureDirectoryExists(folderPath) {
    if (!folderPath) return false;
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`[StemWatcher] Created watch folder: ${folderPath}`);
      }
      return true;
    } catch (err) {
      console.error(`[StemWatcher] Could not create watch folder "${folderPath}":`, err.message);
      return false;
    }
  }

  /**
   * Start watching the target directory
   */
  async start() {
    if (!this.watchFolder) {
      this.setStatus('unavailable', 'No watch folder specified.');
      return;
    }

    // Stop existing watcher if running
    await this.stop();

    if (this.isPaused) {
      this.setStatus('paused', 'Stem watcher is paused.');
      return;
    }

    // Ensure directory exists
    const exists = this.ensureDirectoryExists(this.watchFolder);
    if (!exists) {
      this.setStatus('unavailable', `Folder is unavailable or inaccessible: ${this.watchFolder}`);
      return;
    }

    try {
      console.log(`[StemWatcher] Started`);
      console.log(`[StemWatcher] Watching: ${this.watchFolder}`);

      // Initialize chokidar watcher with awaitWriteFinish for file writing stability
      this.watcher = chokidar.watch(this.watchFolder, {
        ignored: /(^|[\/\\])\..|.*\.tmp$|.*\.flp$|.*\.mid$/,
        persistent: true,
        ignoreInitial: true, // Only detect newly exported stems during session
        depth: 1, // Watch top level and 1 sub-folder level
        awaitWriteFinish: {
          stabilityThreshold: 1000,
          pollInterval: 200,
        },
        usePolling: false, // native OS events on Windows
      });

      this.watcher.on('add', (filePath) => this.handleFileDiscovered(filePath));
      this.watcher.on('change', (filePath) => this.handleFileDiscovered(filePath));
      this.watcher.on('error', (err) => {
        console.error('[StemWatcher] Watcher error:', err.message);
        this.setStatus('error', err.message);
      });

      this.setStatus('watching');
    } catch (err) {
      console.error('[StemWatcher] Failed to start watcher:', err.message);
      this.setStatus('error', err.message);
    }
  }

  /**
   * Stop the watcher
   */
  async stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (_) {}
      this.watcher = null;
    }
  }

  /**
   * Pause watching
   */
  async pause() {
    this.isPaused = true;
    await this.stop();
    this.setStatus('paused', 'Stem watcher paused.');
    console.log('[StemWatcher] Paused');
  }

  /**
   * Resume watching
   */
  async resume() {
    this.isPaused = false;
    console.log('[StemWatcher] Resuming...');
    await this.start();
  }

  /**
   * Get current watch folder path
   * @returns {string}
   */
  getWatchFolder() {
    return this.watchFolder;
  }

  /**
   * Change target watch folder
   * @param {string} newFolder
   */
  async setWatchFolder(newFolder) {
    if (!newFolder || newFolder === this.watchFolder) return;
    console.log(`[StemWatcher] Changing watch folder to: ${newFolder}`);
    this.watchFolder = newFolder;
    // Clear old duplicate cache on folder change
    this.processedFiles.clear();
    await this.start();
  }

  /**
   * Update internal status and notify listeners
   * @param {string} status
   * @param {string} [message=null]
   */
  setStatus(status, message = null) {
    this.status = status;
    this.errorMessage = message;
    this.emit('status-changed', this.getStatus());
  }

  /**
   * Get current watcher status object
   * @returns {object}
   */
  getStatus() {
    return {
      status: this.status, // 'watching' | 'paused' | 'unavailable' | 'error'
      folder: this.watchFolder,
      isPaused: this.isPaused,
      errorMessage: this.errorMessage,
      pendingCount: this.unreviewedStems.length,
    };
  }

  /**
   * Handle candidate file event from chokidar
   * @param {string} filePath
   */
  async handleFileDiscovered(filePath) {
    if (this.isPaused) return;

    if (!this.isTargetStem(filePath)) {
      return;
    }

    const fileName = path.basename(filePath);

    // If currently stabilizing this exact file, let it complete
    if (this.stabilizingFiles.has(filePath)) {
      return;
    }

    console.log(`[StemWatcher] New file detected: ${fileName}`);
    this.stabilizingFiles.add(filePath);

    try {
      // Perform multi-step stability verification to ensure FL Studio has fully finished export
      const isReady = await this.verifyFileStability(filePath);
      if (!isReady) {
        console.warn(`[StemWatcher] File did not stabilize or was removed: ${fileName}`);
        return;
      }

      // Check if file stats have actually changed since last time (duplicate prevention)
      const stats = fs.statSync(filePath);
      const cached = this.processedFiles.get(filePath);

      if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
        // Exact same file already processed
        return;
      }

      // Save to processed cache
      this.processedFiles.set(filePath, {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });

      console.log(`[StemWatcher] File ready: ${fileName} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

      const stemObject = {
        name: fileName,
        path: filePath,
        extension: path.extname(filePath).toLowerCase(),
        size: stats.size,
        detectedAt: new Date().toISOString(),
      };

      this.emit('file-ready', stemObject);

      // Add to batch queue
      this.queueStemForBatch(stemObject);
    } catch (err) {
      console.warn(`[StemWatcher] Error processing file "${fileName}":`, err.message);
    } finally {
      this.stabilizingFiles.delete(filePath);
    }
  }

  /**
   * Verify that FL Studio export has finished writing to disk
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  async verifyFileStability(filePath, maxAttempts = 15, intervalMs = 400) {
    console.log(`[StemWatcher] Waiting for file stability... (${path.basename(filePath)})`);
    let lastSize = -1;
    let stableConsecutiveChecks = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      try {
        const stats = fs.statSync(filePath);
        const currentSize = stats.size;

        if (currentSize > 0 && currentSize === lastSize) {
          stableConsecutiveChecks++;
          // Require at least 2 consecutive identical size checks AND ability to read bytes
          if (stableConsecutiveChecks >= 2) {
            // Test if file can be opened for reading (no exclusive write lock by FL Studio)
            const canRead = await this.canReadFile(filePath);
            if (canRead) {
              return true;
            }
          }
        } else {
          stableConsecutiveChecks = 0;
          lastSize = currentSize;
        }
      } catch (err) {
        // File may be locked exclusively by FL Studio writer
        stableConsecutiveChecks = 0;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // Final check
    return fs.existsSync(filePath) && (await this.canReadFile(filePath));
  }

  /**
   * Check if file can be opened without locking errors
   * @param {string} filePath
   * @returns {Promise<boolean>}
   */
  canReadFile(filePath) {
    return new Promise((resolve) => {
      fs.open(filePath, 'r', (err, fd) => {
        if (err) {
          resolve(false);
        } else {
          fs.close(fd, () => resolve(true));
        }
      });
    });
  }

  /**
   * Queue stem into debounce grouping
   * @param {object} stemObject
   */
  queueStemForBatch(stemObject) {
    // Avoid duplicate within batch
    const exists = this.pendingBatch.some((s) => s.path === stemObject.path);
    if (!exists) {
      this.pendingBatch.push(stemObject);
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.flushBatch();
    }, this.debounceDelay);
  }

  /**
   * Flush the pending batch of stems and emit grouped event
   */
  flushBatch() {
    if (this.pendingBatch.length === 0) return;

    const stemsBatch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.debounceTimer = null;

    // Append to unreviewed stems
    stemsBatch.forEach((s) => {
      if (!this.unreviewedStems.some((existing) => existing.path === s.path)) {
        this.unreviewedStems.push(s);
      }
    });

    console.log(`[StemWatcher] Added ${stemsBatch.length} stem(s) to upload queue:`, stemsBatch.map((s) => s.name).join(', '));

    // Emit grouped detection event
    this.emit('stems-detected', {
      count: stemsBatch.length,
      stems: stemsBatch,
      allPending: [...this.unreviewedStems],
    });
  }

  /**
   * Get all currently unreviewed stems
   * @returns {Array<object>}
   */
  getPendingStems() {
    return [...this.unreviewedStems];
  }

  /**
   * Clear or dismiss pending stems
   */
  clearPendingStems() {
    this.unreviewedStems = [];
    this.emit('status-changed', this.getStatus());
  }

  /**
   * Remove a single stem from pending list
   * @param {string} filePath
   */
  removePendingStem(filePath) {
    this.unreviewedStems = this.unreviewedStems.filter((s) => s.path !== filePath);
    this.emit('status-changed', this.getStatus());
  }
}

module.exports = StemWatcher;

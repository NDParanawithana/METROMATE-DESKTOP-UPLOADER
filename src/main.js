const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const SettingsManager = require('./services/settingsManager');
const StemWatcher = require('./services/stemWatcher');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
let appTray = null;
let settingsManager = null;
let stemWatcher = null;

// Helper: Create a 16x16 tray icon
function createTrayIcon() {
  // A clean 16x16 SVG data URI with waveform and neon accent
  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect width="16" height="16" rx="3" fill="#0B0E14" />
      <rect x="2" y="6" width="2" height="4" rx="1" fill="#CCFF00" />
      <rect x="5" y="3" width="2" height="10" rx="1" fill="#7C5CFC" />
      <rect x="8" y="5" width="2" height="6" rx="1" fill="#CCFF00" />
      <rect x="11" y="2" width="2" height="12" rx="1" fill="#7C5CFC" />
      <rect x="14" y="7" width="1" height="2" rx="0.5" fill="#CCFF00" />
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`);
}

function updateTrayMenu() {
  if (!appTray) return;

  const isPaused = stemWatcher ? stemWatcher.isPaused : false;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open MetroMate Uploader',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: isPaused ? '▶ Resume Stem Watcher' : '⏸ Pause Stem Watcher',
      click: async () => {
        if (!stemWatcher) return;
        if (isPaused) {
          await stemWatcher.resume();
          settingsManager.saveSettings({ isPaused: false });
        } else {
          await stemWatcher.pause();
          settingsManager.saveSettings({ isPaused: true });
        }
        updateTrayMenu();
      },
    },
    {
      label: '📁 Open Watch Folder',
      click: async () => {
        if (stemWatcher) {
          const folder = stemWatcher.getWatchFolder();
          if (fs.existsSync(folder)) {
            shell.openPath(folder);
          } else {
            dialog.showErrorBox('Watch Folder Missing', `Folder does not exist:\n${folder}`);
          }
        }
      },
    },
    {
      label: '⚙ Settings',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('app:openSettings');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  appTray.setContextMenu(contextMenu);
  appTray.setToolTip(
    `MetroMate Stem Watcher (${isPaused ? 'Paused' : 'Watching: ' + path.basename(stemWatcher?.getWatchFolder() || '')})`
  );
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    title: 'MetroMate - Desktop Stem Uploader',
    width: 1120,
    height: 740,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#0B0E14',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  // 1. Initialize Settings and Watcher
  settingsManager = new SettingsManager(app);
  const settings = settingsManager.getSettings();

  stemWatcher = new StemWatcher({
    watchFolder: settings.watchFolder,
    isPaused: settings.isPaused,
    debounceDelay: 1200,
  });

  // 2. Set up notification and event bridging
  stemWatcher.on('stems-detected', (data) => {
    // Forward to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:stemsDetected', data);
    }

    // Show native Windows notification
    try {
      if (Notification.isSupported()) {
        const title = 'New stems detected';
        const count = data.count || (data.stems ? data.stems.length : 1);
        const stemList = (data.stems || []).map((s) => s.name).slice(0, 3).join(', ');
        const extra = count > 3 ? ` and ${count - 3} more` : '';
        const body = `${count} ${count === 1 ? 'WAV stem is' : 'WAV stems are'} ready to upload. (${stemList}${extra})`;

        const notif = new Notification({
          title,
          body,
          silent: false,
        });

        notif.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('watcher:focusDetectedStems', data);
          }
        });

        notif.show();
      }
    } catch (notifErr) {
      console.warn('[Main] Could not display Windows notification:', notifErr.message);
    }
  });

  stemWatcher.on('status-changed', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:statusChanged', status);
    }
    updateTrayMenu();
  });

  // 3. Create Tray Icon
  try {
    appTray = new Tray(createTrayIcon());
    updateTrayMenu();
    appTray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (trayErr) {
    console.warn('[Main] Tray initialization warning:', trayErr.message);
  }

  // 4. Create Main Window
  createWindow();

  // 5. Start Watcher
  await stemWatcher.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle selecting audio stem files via native dialog
ipcMain.handle('dialog:selectStemFiles', async () => {
  const mainWindow = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Stem Files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Audio Stems (*.wav, *.mp3, *.flac, *.aiff, *.aif)',
        extensions: ['wav', 'mp3', 'flac', 'aiff', 'aif'],
      },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return [];
  }

  const files = filePaths.map((filePath) => {
    let sizeInBytes = 0;
    try {
      const stats = fs.statSync(filePath);
      sizeInBytes = stats.size;
    } catch (err) {
      console.error('Error reading file stats for:', filePath, err);
    }

    return {
      name: path.basename(filePath),
      path: filePath,
      extension: path.extname(filePath).toLowerCase(),
      size: sizeInBytes,
    };
  });

  return files;
});

// Handle reading audio file buffer for audio playback & BPM analysis
ipcMain.handle('dialog:readStemBuffer', async (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      console.warn('Audio file does not exist at path:', filePath);
      return null;
    }
    const fileBuffer = await fs.promises.readFile(filePath);
    return new Uint8Array(fileBuffer).buffer;
  } catch (err) {
    console.error('Error reading stem buffer for audio playback:', filePath, err);
    return null;
  }
});

// Helper: Get audio mime type
function getMimeType(ext) {
  const extension = (ext || '').toLowerCase();
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.flac') return 'audio/flac';
  if (extension === '.aiff' || extension === '.aif') return 'audio/aiff';
  return 'audio/wav';
}

// Helper: Format and normalize API URL (e.g. converting 0.0.0.0 to 127.0.0.1)
function normalizeApiUrl(rawUrl) {
  let url = (rawUrl || 'http://localhost:5050').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  // 0.0.0.0 is a server bind address, not a valid client destination address
  url = url.replace(/\/\/0\.0\.0\.0(?::|$)/, (match) => match.replace('0.0.0.0', '127.0.0.1'));
  return url;
}

// 0. User Login to Metromate Backend
ipcMain.handle('api:login', async (event, { apiUrl, email, password }) => {
  const baseUrl = normalizeApiUrl(apiUrl);
  const candidateEndpoints = [
    `${baseUrl}/api/auth/login`,
    `${baseUrl}/auth/login`,
    `${baseUrl}/api/login`,
    `${baseUrl}/api/users/login`,
  ];

  let lastError = null;

  for (const url of candidateEndpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(4000),
      });

      if (response.status === 404) {
        // Try next candidate endpoint
        continue;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Login failed with status ${response.status}`);
      }

      return {
        success: true,
        isOnline: true,
        token: data.token,
        user: data.user || { name: email.split('@')[0], email },
      };
    } catch (err) {
      lastError = err;
      if (err.name !== 'TypeError' && err.name !== 'TimeoutError' && !err.message.includes('fetch failed')) {
        // Business logic error from server (e.g. wrong password)
        return {
          success: false,
          error: err.message || 'Could not log in to Metromate server.',
        };
      }
    }
  }

  console.warn('Login request failed to', baseUrl, lastError?.message);

  // If server is unreachable in development, provide simulated login for testing
  const simulatedName = email ? email.split('@')[0].toUpperCase() : 'ARTIST';
  return {
    success: true,
    isOnline: false,
    isDemoAuth: true,
    token: 'demo_jwt_token_' + Date.now(),
    user: {
      id: 'demo_user_1',
      name: simulatedName,
      email: email,
    },
    message: 'Connected in Offline/Dev mode.',
  };
});

// 1. Fetch Metromate projects from Express backend (Supports Solo Projects & Collaboration Projects)
ipcMain.handle('api:getProjects', async (event, { apiUrl, token, artistEmail }) => {
  const baseUrl = normalizeApiUrl(apiUrl);

  // Check if server is alive
  let isServerAlive = false;
  try {
    const hRes = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (hRes.ok) isServerAlive = true;
  } catch (_) {}

  // If user is not logged in, require authentication
  if (!artistEmail && !token) {
    return {
      success: false,
      isOnline: isServerAlive,
      requiresAuth: true,
      error: 'Please log in to your MetroMate account to view and upload to your projects.',
      projects: [],
    };
  }

  // Candidate endpoints for fetching projects for the authenticated artist
  const candidateEndpoints = [];
  if (artistEmail) {
    candidateEndpoints.push(`${baseUrl}/api/projects/solo?artistEmail=${encodeURIComponent(artistEmail)}`);
    candidateEndpoints.push(`${baseUrl}/api/projects/collab?artistEmail=${encodeURIComponent(artistEmail)}`);
  } else {
    candidateEndpoints.push(
      `${baseUrl}/api/projects/solo`,
      `${baseUrl}/api/projects/collab`,
      `${baseUrl}/api/projects`
    );
  }

  const headers = { 'Accept': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let allProjects = [];

  for (const url of candidateEndpoints) {
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(6000) });
      
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      isServerAlive = true;

      const rawList = Array.isArray(data) ? data : (data.data || data.projects || []);

      const formattedProjects = rawList.map((p) => {
        const id = p._id || p.id || String(Math.random());
        const bpmVal = p.bpm || p.songInfoData?.tempo || (p.ideationData?.bpm ? parseInt(p.ideationData.bpm) : null) || '';
        const keyVal = p.musicalKey || p.songInfoData?.musicalKey || p.ideationData?.musicalKey || p.key || '';
        const stemsList = Array.isArray(p.stems) ? p.stems : [];

        let rawStage = p.stage || p.currentStage || p.workflowStage || p.productionStage || p.status || p.songInfoData?.stage || 'Idea / Composition';

        return {
          id: id,
          _id: id,
          title: p.title || p.songInfoData?.songTitle || 'Untitled Project',
          projectType: p.projectType || p.type || (p.collaboratorEmails ? 'Collab' : 'Single'),
          genre: p.genre || p.songInfoData?.genre || 'General',
          stage: rawStage,
          progress: p.progress !== undefined ? p.progress : 0,
          bpm: bpmVal,
          musicalKey: keyVal,
          collaborators: p.collaboratorNames || p.collaborators || (p.artistEmail ? [p.artistEmail] : ['Solo Project']),
          artistEmail: p.artistEmail || '',
          stems: stemsList,
          stemCount: stemsList.length,
          updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
        };
      });

      allProjects = allProjects.concat(formattedProjects);
    } catch (err) {
      console.warn('Error querying endpoint:', url, err.message);
    }
  }

  // Deduplicate by project ID
  const seenIds = new Set();
  const uniqueProjects = allProjects.filter((p) => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });

  return {
    success: true,
    isOnline: isServerAlive,
    projects: uniqueProjects,
  };
});

// 2. Upload stem file and metadata to Metromate Express backend
ipcMain.handle('api:uploadStem', async (event, { apiUrl, token, projectId, stemData, filePath, artistEmail }) => {
  const baseUrl = normalizeApiUrl(apiUrl);

  try {
    if (!artistEmail && !token) {
      return {
        success: false,
        error: 'Authentication required: You must be logged in to your MetroMate account to upload stems.',
      };
    }

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Stem file does not exist on disk: ${filePath}`);
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const fileExt = path.extname(filePath).replace('.', '').toLowerCase();
    const fileName = path.basename(filePath);
    const stemTitle = stemData.title || fileName.replace(/\.[^/.]+$/, '');
    const uploader = artistEmail || stemData.uploadedBy || 'FL Studio Producer';

    // 1. Try POST /api/projects/upload-stem (Base64 JSON endpoint from Solo Project controller)
    try {
      const base64Data = fileBuffer.toString('base64');
      const uploadRes = await fetch(`${baseUrl}/api/projects/upload-stem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          audioBase64: base64Data,
          filename: fileName,
          ext: fileExt,
          stemName: stemTitle,
          uploadedBy: uploader,
        }),
      });

      if (uploadRes.ok) {
        const uploadResult = await uploadRes.json();
        const rawFileUrl = (uploadResult.data && uploadResult.data.fileUrl) || uploadResult.fileUrl || (uploadResult.data && uploadResult.data.url) || uploadResult.url || '';
        let fullAudioUrl = rawFileUrl;
        if (fullAudioUrl && !fullAudioUrl.startsWith('http://') && !fullAudioUrl.startsWith('https://')) {
          fullAudioUrl = `${baseUrl}${fullAudioUrl.startsWith('/') ? '' : '/'}${fullAudioUrl}`;
        }

        const uploadedStem = {
          name: stemTitle,
          title: stemTitle,
          bpm: stemData.bpm || '',
          key: stemData.key || '',
          description: stemData.description || '',
          fileUrl: fullAudioUrl || rawFileUrl,
          url: fullAudioUrl || rawFileUrl,
          audioUrl: fullAudioUrl || rawFileUrl,
          relativeUrl: rawFileUrl,
          uploadedBy: uploader,
          sizeBytes: fileBuffer.length,
          createdAt: new Date().toISOString(),
          ...(uploadResult.data || {}),
          fileUrl: fullAudioUrl || rawFileUrl,
          url: fullAudioUrl || rawFileUrl,
          audioUrl: fullAudioUrl || rawFileUrl,
        };

        // If project ID is provided and is a Mongo ID, attach stem to SoloProject or CollabProject
        if (projectId && !projectId.startsWith('proj_demo_')) {
          const stemPayload = {
            id: `stem_${Date.now()}`,
            name: stemTitle,
            title: stemTitle,
            bpm: stemData.bpm || '',
            key: stemData.key || '',
            description: stemData.description || '',
            fileUrl: fullAudioUrl || rawFileUrl,
            url: fullAudioUrl || rawFileUrl,
            audioUrl: fullAudioUrl || rawFileUrl,
            sizeBytes: fileBuffer.length,
            uploadedBy: uploader,
            createdAt: new Date().toISOString(),
          };

          let attached = false;

          // 1. Try attaching to SoloProject via PUT /api/projects/solo/:id
          try {
            const projRes = await fetch(`${baseUrl}/api/projects/solo/${projectId}`);
            if (projRes.ok) {
              const projData = await projRes.json();
              const currentProject = projData.data || projData;
              if (currentProject && (currentProject._id || currentProject.id)) {
                const existingStems = Array.isArray(currentProject.stems) ? currentProject.stems : [];
                const updatedStems = [...existingStems, stemPayload];

                await fetch(`${baseUrl}/api/projects/solo/${projectId}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify({ stems: updatedStems }),
                });
                attached = true;
              }
            }
          } catch (attachErr) {
            console.warn('Could not attach stem to SoloProject document:', attachErr.message);
          }

          // 2. If not a SoloProject, try attaching to CollabProject via PUT /api/projects/collab/:id
          if (!attached) {
            try {
              const collabRes = await fetch(`${baseUrl}/api/projects/collab/${projectId}`);
              if (collabRes.ok) {
                const collabData = await collabRes.json();
                const currentCollab = collabData.data || collabData;
                if (currentCollab && (currentCollab._id || currentCollab.id)) {
                  const existingStems = Array.isArray(currentCollab.stems) ? currentCollab.stems : [];
                  const updatedStems = [...existingStems, stemPayload];

                  await fetch(`${baseUrl}/api/projects/collab/${projectId}`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Accept': 'application/json',
                      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ stems: updatedStems }),
                  });
                  attached = true;
                }
              }
            } catch (collabErr) {
              console.warn('Could not attach stem to CollabProject document:', collabErr.message);
            }
          }
        }

        return { success: true, stem: uploadedStem };
      }
    } catch (base64Err) {
      console.warn('Base64 upload-stem failed, attempting multipart fallback:', base64Err.message);
    }

    // 2. Multipart FormData fallback (POST /api/projects/:id/stems)
    const mimeType = getMimeType(path.extname(filePath));
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('stemFile', blob, fileName);
    formData.append('title', stemTitle);
    formData.append('bpm', stemData.bpm ? String(stemData.bpm) : '');
    formData.append('key', stemData.key || '');
    formData.append('description', stemData.description || '');
    formData.append('fileSize', String(stemData.size || fileBuffer.length));
    formData.append('format', path.extname(filePath).toLowerCase());

    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const candidateEndpoints = [
      `${baseUrl}/api/projects/${projectId}/stems`,
      `${baseUrl}/projects/${projectId}/stems`,
      `${baseUrl}/api/v1/projects/${projectId}/stems`,
    ];

    let lastError = null;
    for (const url of candidateEndpoints) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (response.status === 404) {
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Upload failed with HTTP ${response.status}: ${errText}`);
        }

        const result = await response.json();
        return { success: true, stem: result.stem || result };
      } catch (err) {
        lastError = err;
        if (!err.message.includes('404')) {
          throw err;
        }
      }
    }

    throw lastError || new Error(`Could not upload stem to ${baseUrl}`);
  } catch (err) {
    console.error('Stem upload error for file:', filePath, err);
    return { success: false, error: err.message };
  }
});

// 3. Open URL in external browser
ipcMain.handle('shell:openExternal', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

// ==========================================
// 4. STEM WATCHER IPC HANDLERS
// ==========================================

// Get current watcher status & configuration
ipcMain.handle('watcher:getStatus', async () => {
  if (!stemWatcher) {
    return { status: 'unavailable', folder: '', isPaused: false, pendingCount: 0 };
  }
  return stemWatcher.getStatus();
});

// Set custom watch folder and persist
ipcMain.handle('watcher:setFolder', async (event, folderPath) => {
  try {
    if (!folderPath || typeof folderPath !== 'string') {
      throw new Error('Invalid folder path provided.');
    }
    const cleanPath = path.normalize(folderPath.trim());
    if (stemWatcher) {
      await stemWatcher.setWatchFolder(cleanPath);
    }
    if (settingsManager) {
      settingsManager.saveSettings({ watchFolder: cleanPath });
    }
    updateTrayMenu();
    return { success: true, status: stemWatcher ? stemWatcher.getStatus() : null };
  } catch (err) {
    console.error('[Main] watcher:setFolder error:', err);
    return { success: false, error: err.message };
  }
});

// Open native folder selection dialog
ipcMain.handle('watcher:selectFolderDialog', async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow();
  const defaultPath = stemWatcher ? stemWatcher.getWatchFolder() : app.getPath('music');

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select Stem Watch Folder',
    defaultPath: fs.existsSync(defaultPath) ? defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const selectedFolder = filePaths[0];
  if (stemWatcher) {
    await stemWatcher.setWatchFolder(selectedFolder);
  }
  if (settingsManager) {
    settingsManager.saveSettings({ watchFolder: selectedFolder });
  }
  updateTrayMenu();

  return {
    canceled: false,
    folder: selectedFolder,
    status: stemWatcher ? stemWatcher.getStatus() : null,
  };
});

// Reset watch folder to default Music directory
ipcMain.handle('watcher:resetDefault', async () => {
  try {
    const defaultFolder = settingsManager ? settingsManager.getDefaultWatchFolder() : path.join(app.getPath('music'), 'Collaboration Stems');
    if (stemWatcher) {
      await stemWatcher.setWatchFolder(defaultFolder);
    }
    if (settingsManager) {
      settingsManager.saveSettings({ watchFolder: defaultFolder });
    }
    updateTrayMenu();
    return { success: true, folder: defaultFolder, status: stemWatcher ? stemWatcher.getStatus() : null };
  } catch (err) {
    console.error('[Main] watcher:resetDefault error:', err);
    return { success: false, error: err.message };
  }
});

// Pause watching
ipcMain.handle('watcher:pause', async () => {
  if (stemWatcher) {
    await stemWatcher.pause();
    if (settingsManager) {
      settingsManager.saveSettings({ isPaused: true });
    }
    updateTrayMenu();
    return stemWatcher.getStatus();
  }
  return { status: 'paused', isPaused: true };
});

// Resume watching
ipcMain.handle('watcher:resume', async () => {
  if (stemWatcher) {
    await stemWatcher.resume();
    if (settingsManager) {
      settingsManager.saveSettings({ isPaused: false });
    }
    updateTrayMenu();
    return stemWatcher.getStatus();
  }
  return { status: 'watching', isPaused: false };
});

// Open watch folder in Windows Explorer
ipcMain.handle('watcher:openFolder', async () => {
  if (stemWatcher) {
    const folder = stemWatcher.getWatchFolder();
    if (!fs.existsSync(folder)) {
      try {
        fs.mkdirSync(folder, { recursive: true });
      } catch (err) {
        return { success: false, error: `Could not create folder: ${err.message}` };
      }
    }
    await shell.openPath(folder);
    return { success: true, folder };
  }
  return { success: false, error: 'Watcher not initialized' };
});

// Get pending unreviewed stems
ipcMain.handle('watcher:getPendingStems', async () => {
  if (stemWatcher) {
    return stemWatcher.getPendingStems();
  }
  return [];
});

// Dismiss pending stems
ipcMain.handle('watcher:dismissPending', async () => {
  if (stemWatcher) {
    stemWatcher.clearPendingStems();
    return true;
  }
  return false;
});





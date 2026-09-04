const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
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
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
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

  // Candidate endpoints for fetching projects
  const candidateEndpoints = [];
  if (artistEmail) {
    candidateEndpoints.push(`${baseUrl}/api/projects/solo?artistEmail=${encodeURIComponent(artistEmail)}`);
  }
  candidateEndpoints.push(
    `${baseUrl}/api/projects/solo`,
    `${baseUrl}/api/projects`,
    `${baseUrl}/projects`,
    `${baseUrl}/api/v1/projects`
  );

  const headers = { 'Accept': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let isServerAlive = false;
  let lastStatus = null;
  let lastErrorMsg = '';

  for (const url of candidateEndpoints) {
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(6000) });
      
      if (response.status === 404) {
        lastStatus = 404;
        isServerAlive = true;
        continue;
      }

      if (!response.ok) {
        lastStatus = response.status;
        isServerAlive = true;
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      isServerAlive = true;

      // Extract raw projects list from response (handles { success: true, data: [...] } or { projects: [...] })
      const rawList = Array.isArray(data) ? data : (data.data || data.projects || []);

      const formattedProjects = rawList.map((p) => {
        const id = p._id || p.id || String(Math.random());
        const bpmVal = p.bpm || p.songInfoData?.tempo || (p.ideationData?.bpm ? parseInt(p.ideationData.bpm) : null) || '';
        const keyVal = p.musicalKey || p.songInfoData?.musicalKey || p.ideationData?.musicalKey || p.key || '';
        const stemsList = Array.isArray(p.stems) ? p.stems : [];

        // Extract raw stage directly from MongoDB document (e.g. "Idea / Composition", "Recording", "Pre-Production", etc.)
        let rawStage = p.stage || p.currentStage || p.workflowStage || p.productionStage || p.status || p.songInfoData?.stage || '';

        // If not explicitly set, infer from active nested sub-documents
        if (!rawStage || rawStage.trim() === '' || rawStage === 'In Progress' || rawStage === 'active') {
          if (p.releaseData && Object.keys(p.releaseData).length > 0 && (p.releaseData.isCompleted || p.releaseData.status)) {
            rawStage = 'Release & Distribution';
          } else if ((p.postproductionData || p.postProductionData || p.mixingData) && Object.keys(p.postproductionData || p.postProductionData || p.mixingData || {}).length > 0) {
            rawStage = 'Mixing & Mastering';
          } else if ((p.recordingData || p.productionData) && Object.keys(p.recordingData || p.productionData || {}).length > 0) {
            rawStage = 'Recording';
          } else if ((p.preproductionData || p.preProductionData) && Object.keys(p.preproductionData || p.preProductionData || {}).length > 0) {
            rawStage = 'Pre-Production';
          } else {
            rawStage = 'Idea / Composition';
          }
        }

        return {
          id: id,
          _id: id,
          title: p.title || p.songInfoData?.songTitle || 'Untitled Solo Project',
          projectType: p.projectType || p.type || 'Single',
          genre: p.genre || p.songInfoData?.genre || 'General',
          stage: rawStage,
          progress: p.progress !== undefined ? p.progress : 0,
          bpm: bpmVal,
          musicalKey: keyVal,
          collaborators: p.collaborators || (p.artistEmail ? [p.artistEmail] : ['Solo Project']),
          artistEmail: p.artistEmail || '',
          stems: stemsList,
          stemCount: stemsList.length,
          updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
        };
      });

      console.log(`Fetched ${formattedProjects.length} projects from ${url}`);

      return {
        success: true,
        isOnline: true,
        endpoint: url,
        projects: formattedProjects,
      };
    } catch (err) {
      lastErrorMsg = err.message;
      if (lastStatus !== 404) {
        break;
      }
    }
  }

  // If projects routes failed, check /api/health to confirm if server is alive
  if (!isServerAlive) {
    try {
      const hRes = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (hRes.ok) isServerAlive = true;
    } catch (_) {}
  }

  console.warn('Could not fetch projects from backend:', baseUrl, lastErrorMsg || `Status ${lastStatus}`);

  const fallbackProjects = [
    {
      id: 'proj_demo_01',
      title: 'Neon Nights Collaboration',
      bpm: 128,
      musicalKey: 'A Minor',
      collaborators: ['Stan', 'Producer Alex'],
      stemCount: 4,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'proj_demo_02',
      title: 'Midnight Lo-Fi Session',
      bpm: 85,
      musicalKey: 'C# Minor',
      collaborators: ['Stan', 'Sarah Vocalist'],
      stemCount: 6,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'proj_demo_03',
      title: 'Cinematic Atmosphere 2026',
      bpm: 110,
      musicalKey: 'F Major',
      collaborators: ['Stan'],
      stemCount: 2,
      updatedAt: new Date().toISOString(),
    },
  ];

  if (isServerAlive) {
    return {
      success: true,
      isOnline: true,
      isDemoFallback: true,
      warning: `Connected to backend at ${baseUrl}, but no solo projects were found or route returned 404.`,
      projects: fallbackProjects,
    };
  }

  return {
    success: false,
    isOnline: false,
    error: `Could not connect to backend at ${baseUrl}. Showing offline/demo projects.`,
    projects: fallbackProjects,
  };
});

// 2. Upload stem file and metadata to Metromate Express backend
ipcMain.handle('api:uploadStem', async (event, { apiUrl, token, projectId, stemData, filePath, artistEmail }) => {
  const baseUrl = normalizeApiUrl(apiUrl);

  try {
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




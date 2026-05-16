const { app, BrowserWindow, session, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Register custom protocols before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'polytrack', privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

// Intercept network requests to serve modified game files
function setupNetworkInterception() {
  console.log('🔧 Setting up network interception for modified game files...');

  // Read our modified main.bundle.js
  const modifiedBundlePath = path.join(__dirname, 'deobfuscated-main.bundle.js');

  if (!fs.existsSync(modifiedBundlePath)) {
    console.error('❌ Modified main.bundle.js not found at:', modifiedBundlePath);
    console.error('   Please copy the modified bundle to this location first!');
    return false;
  }

  const modifiedBundle = fs.readFileSync(modifiedBundlePath, 'utf8');
  console.log('✅ Modified main.bundle.js loaded:', modifiedBundle.length, 'bytes');

  // Read our modified simulation_worker.bundle.js (with injected hooks)
  const modifiedWorkerPath = path.join(__dirname, 'simulation_worker_with_hooks.bundle.js');

  if (!fs.existsSync(modifiedWorkerPath)) {
    console.error('❌ Modified simulation_worker.bundle.js not found at:', modifiedWorkerPath);
    console.error('   Please copy the modified worker to this location first!');
    return false;
  }

  const modifiedWorker = fs.readFileSync(modifiedWorkerPath, 'utf8');
  console.log('✅ Modified simulation_worker.bundle.js loaded:', modifiedWorker.length, 'bytes');

  // Read local physics WASM file
  const physicsWasmPath = path.join(__dirname, 'lib', 'polytrack_physics.wasm');
  let physicsWasmBuffer = null;
  if (fs.existsSync(physicsWasmPath)) {
    physicsWasmBuffer = fs.readFileSync(physicsWasmPath);
    console.log('✅ Local physics WASM loaded:', physicsWasmBuffer.length, 'bytes');
  } else {
    console.warn('⚠️ Local physics WASM not found at:', physicsWasmPath);
  }

  // Register custom protocol to serve modified files
  protocol.registerBufferProtocol('polytrack', (request, callback) => {
    const url = request.url.substr(12); // Remove 'polytrack://' prefix
    console.log('📥 Protocol request:', url);

    if (url.includes('main.bundle.js')) {
      console.log('🔄 Serving modified main.bundle.js');
      callback({
        data: Buffer.from(modifiedBundle),
        mimeType: 'application/javascript'
      });
    } else if (url.includes('simulation_worker.bundle.js')) {
      console.log('🔄 Serving modified simulation_worker.bundle.js (with hooks!)');
      callback({
        data: Buffer.from(modifiedWorker),
        mimeType: 'application/javascript'
      });
    } else if (url.includes('polytrack_physics.wasm')) {
      // Serve local WASM file to avoid CORS issues
      if (physicsWasmBuffer) {
        console.log('🔄 Serving local physics WASM:', physicsWasmBuffer.length, 'bytes');
        callback({
          data: physicsWasmBuffer,
          mimeType: 'application/wasm'
        });
      } else {
        console.error('❌ Local physics WASM not found, fetching from server...');
        // Fall through to server fetch
      }
    } else {
      // For other files, fetch from the real server with proper headers
      const realUrl = 'https://' + url;
      console.log('📡 Fetching from real server:', realUrl);

      // Add proper headers to mimic browser request
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36',
        'Referer': 'https://app-polytrack.kodub.com/0.6.0/',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://app-polytrack.kodub.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      };

      fetch(realUrl, { headers: headers }).then(response => {
        if (!response.ok) {
          console.error('❌ Fetch failed:', response.status);
          callback(-6); // Connection failed
          return;
        }
        return response.arrayBuffer();
      }).then(buffer => {
        if (buffer) {
          const mimeType = url.endsWith('.wasm') ? 'application/wasm' :
                          url.endsWith('.js') ? 'application/javascript' :
                          url.endsWith('.html') ? 'text/html' :
                          'application/octet-stream';

          callback({
            data: Buffer.from(buffer),
            mimeType: mimeType
          });
        }
      }).catch(err => {
        console.error('❌ Fetch error:', err);
        callback(-2); // Failed to fetch
      });
    }
  });

  // Redirect requests for main.bundle.js to our custom protocol
  // Note: We do NOT intercept simulation_worker.bundle.js or WASM files here
  // The Worker constructor hook in the renderer process will handle workers
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://app-polytrack.kodub.com/*'] },
    (details, callback) => {
      console.log('📡 Request:', details.url);

      if (details.url.includes('/main.bundle.js')) {
        const newUrl = details.url.replace('https://app-polytrack.kodub.com', 'polytrack://app-polytrack.kodub.com');
        console.log('🔄 Redirecting main.bundle.js to:', newUrl);
        callback({ redirectURL: newUrl });
      } else if (details.url.includes('polytrack_physics.wasm')) {
        // Redirect WASM requests to our local protocol
        const newUrl = details.url.replace('https://app-polytrack.kodub.com', 'polytrack://app-polytrack.kodub.com');
        console.log('🔄 Redirecting WASM to local protocol:', newUrl);
        callback({ redirectURL: newUrl });
      } else {
        // Let all other requests through normally (including simulation_worker.bundle.js)
        callback({ cancel: false });
      }
    }
  );

  // Add CORS headers to allow WASM loading from blob URLs
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://app-polytrack.kodub.com/*'] },
    (details, callback) => {
      const headers = details.responseHeaders;
      // Add CORS headers to allow blob URL workers to fetch resources
      headers['Access-Control-Allow-Origin'] = ['*'];
      headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
      headers['Access-Control-Allow-Headers'] = ['*'];
      callback({ responseHeaders: headers });
    }
  );

  console.log('✅ Network interception active!');
  return true;
}

// Serve the worker hooks file via custom protocol
function createWindow() {
  console.log('🚀 Creating TS PML window...');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      devTools: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'wasm-preload.js')
    },
    show: true
  });

  // Force DevTools to open with keyboard shortcut
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Cmd+Option+I or Ctrl+Shift+I
    if (input.key === 'i' && (input.meta || input.control) && input.alt && !input.shift) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('📄 Page loaded');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('❌ Page failed to load:', errorCode, errorDescription);
  });

  // Load the pure PolyTrack game
  console.log('📄 Loading pure PolyTrack game...');
  mainWindow.loadURL('https://app-polytrack.kodub.com/0.6.0/');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  setupNetworkInterception();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

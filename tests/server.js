/**
 * Simple HTTP server for testing TS PML mods
 * Run with: node tests/server.js
 * Then load http://localhost:8080/test-mod/manifest.json in PolyModLoader
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const TEST_DIR = '/Users/rewis/polytrack-dev/ts-pml/test-mod';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Remove /test-mod prefix if present
  let urlPath = req.url;
  if (urlPath.startsWith('/test-mod/')) {
    urlPath = urlPath.substring('/test-mod/'.length);
  } else if (urlPath === '/test-mod') {
    urlPath = '/manifest.json';
  }

  // Default to test-mod directory
  let filePath = path.join(TEST_DIR, urlPath);

  // Remove query string
  filePath = filePath.split('?')[0];

  // Default to index.html for directory requests
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }

  // Get file extension
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Read and serve file
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  TS PML Test Server Running!                               ║
╠════════════════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                            ║
║                                                             ║
║  Test these URLs in PolyModLoader:                          ║
║  • http://localhost:${PORT}/test-mod/manifest.json           ║
║                                                             ║
║  Press Ctrl+C to stop                                       ║
╚════════════════════════════════════════════════════════════╝
  `);
});

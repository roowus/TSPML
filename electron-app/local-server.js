/**
 * Simple HTTP server to serve modified PolyTrack files
 * Run with: node local-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const GAME_DIR = path.join(__dirname);

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Parse URL
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    // Special handling for main.bundle.js - serve our modified version
    if (filePath.includes('main.bundle.js')) {
        console.log('🔄 Serving modified main.bundle.js');
        const modifiedBundle = path.join(GAME_DIR, 'deobfuscated-main.bundle.js');

        fs.readFile(modifiedBundle, 'utf8', (err, data) => {
            if (err) {
                console.error('❌ Error reading modified bundle:', err);
                res.writeHead(500);
                res.end('Error loading modified bundle');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end(data);
        });
        return;
    }

    // For all other files, proxy to the real server
    const realUrl = 'https://app-polytrack.kodub.com' + req.url;
    console.log(`📡 Proxying to: ${realUrl}`);

    // Use https module to fetch from real server
    const https = require('https');

    const proxyReq = https.get(realUrl, (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] || mimeTypes[path.extname(filePath)] || 'application/octet-stream';

        res.writeHead(proxyRes.statusCode, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
        });

        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        console.error('❌ Proxy error:', err);
        res.writeHead(500);
        res.end('Error proxying request');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Local PolyTrack server running at http://localhost:${PORT}`);
    console.log(`📁 Serving modified main.bundle.js from: ${GAME_DIR}`);
    console.log(`📡 Proxying all other requests to: https://app-polytrack.kodub.com`);
    console.log('\n✅ Ready! Navigate to http://localhost:8080/0.6.0/ in your browser');
});

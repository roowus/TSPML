/**
 * WASM Loading Diagnostics
 * Paste this in DevTools console to see how WASM is loaded
 */

console.log('🔍 WASM Loading Diagnostics');
console.log('==========================\n');

// Check what WASM is exposed
if (window.__TS_PML_WASM__) {
    console.log('✅ WASM is exposed in main thread!');
    console.log('   Memory:', window.__TS_PML_WASM__.memory);
    console.log('   Exports:', Object.keys(window.__TS_PML_WASM__.exports));
} else {
    console.log('❌ WASM not exposed in main thread');
    console.log('   This likely means WASM is loaded in a worker');
}

// Check for workers
setTimeout(() => {
    console.log('\n📊 Checking for workers...');

    // Try to find workers in the page
    const elements = document.querySelectorAll('*');
    let workerCount = 0;

    console.log('   Looking for worker activity...');

    // Monitor fetch requests for WASM files
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0];

        if (typeof url === 'string' && url.includes('.wasm')) {
            console.log(`\n🎯 WASM file requested: ${url}`);

            return originalFetch.apply(this, args)
                .then(response => {
                    console.log(`   Status: ${response.status}`);
                    console.log(`   Type: ${response.headers.get('content-type')}`);
                    console.log(`   Size: ${response.headers.get('content-length')} bytes`);

                    // Clone to read the response
                    return response.clone().arrayBuffer().then(buffer => {
                        console.log(`   Buffer size: ${buffer.byteLength} bytes`);
                        console.log('   ✅ WASM binary captured!');

                        // This is the WASM file - we could analyze it here
                        window.__LAST_WASM_BUFFER__ = buffer;
                        console.log('   Stored in window.__LAST_WASM_BUFFER__');

                        return response;
                    });
                });
        }

        return originalFetch.apply(this, args);
    };

    console.log('✓ Fetch monitoring active - WASM requests will be logged');
    console.log('   Reload the page or start a race to trigger WASM loading\n');

}, 1000);

// Provide instructions
console.log('📋 Instructions:');
console.log('   1. This script will monitor all network requests');
console.log('   2. When you start a race, watch for WASM file requests');
console.log('   3. The script will show when WASM files are loaded');
console.log('   4. Check window.__LAST_WASM_BUFFER__ for the raw WASM binary');

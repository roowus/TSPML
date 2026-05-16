/**
 * Direct WASM File Interception - FIXED VERSION
 * Paste this in console BEFORE loading the page
 * This intercepts the WASM file and injects our code
 */

// Check if already hooked
if (window.__TS_PML_WASM_HOOKS_INSTALLED__) {
    console.log('⚠️ WASM hooks already installed!');
    console.log('   Reload the page to reinstall hooks');
} else {
    console.log('🔧 Setting up direct WASM interception...');

    // Store the original fetch
    const originalFetch = window.fetch;

    // Intercept fetch for WASM files
    window.fetch = async function(url, options) {
        const urlStr = typeof url === 'string' ? url : url.url;

        if (urlStr && urlStr.includes('polytrack_physics.wasm')) {
            console.log('🎯 Intercepting polytrack_physics.wasm!');

            const response = await originalFetch(url, options);
            const clonedResponse = response.clone();
            const wasmBuffer = await clonedResponse.arrayBuffer();

            console.log('📦 WASM binary captured:', wasmBuffer.byteLength, 'bytes');

            window.__CAPTURED_WASM__ = {
                buffer: wasmBuffer,
                uint8Array: new Uint8Array(wasmBuffer)
            };

            console.log('✅ Stored in window.__CAPTURED_WASM__');
            return response;
        }

        return originalFetch(url, options);
    };

    console.log('✅ WASM interception active!');

    // Hook WebAssembly.instantiate
    const originalInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = async function(moduleOrBytes, importObject) {
        const result = await originalInstantiate.call(this, moduleOrBytes, importObject);
        const instance = result.instance || result;

        console.log('🏭 WebAssembly.instantiate called!');

        if (instance.exports && instance.exports.memory) {
            const memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
            console.log(`   Memory: ${memSize.toFixed(2)} MB`);

            if (memSize > 10) {
                console.log('%c✅ THIS IS THE PHYSICS WASM!', 'color: #00ff00; font-weight: bold');

                window.__TS_PML_WASM__ = {
                    instance: instance,
                    exports: instance.exports,
                    memory: instance.exports.memory
                };

                console.log('✅ Stored in window.__TS_PML_WASM__');
            }
        }

        return result;
    };

    console.log('✅ WebAssembly hooks installed!');
    console.log('   Start a race - WASM will be captured when physics loads');

    window.__TS_PML_WASM_HOOKS_INSTALLED__ = true;
}

/**
 * Paste THIS in browser console - no syntax errors!
 */

(function() {
    if (window.__TS_PML_WASM_HOOKS_INSTALLED__) {
        console.log('⚠️ WASM hooks already installed!');
        return;
    }

    console.log('🔧 Setting up WASM interception...');

    const originalFetch = window.fetch;

    window.fetch = async function(url, options) {
        const urlStr = typeof url === 'string' ? url : url.url;

        if (urlStr && urlStr.includes('polytrack_physics.wasm')) {
            console.log('🎯 Intercepting polytrack_physics.wasm!');

            const response = await originalFetch(url, options);
            const clonedResponse = response.clone();
            const wasmBuffer = await clonedResponse.arrayBuffer();

            console.log('📦 WASM binary:', wasmBuffer.byteLength, 'bytes');

            window.__CAPTURED_WASM__ = {
                buffer: wasmBuffer,
                uint8Array: new Uint8Array(wasmBuffer)
            };

            console.log('✅ Stored in window.__CAPTURED_WASM__');
            return response;
        }

        return originalFetch(url, options);
    };

    console.log('✅ Fetch hook installed!');

    const originalInstantiate = WebAssembly.instantiate;

    WebAssembly.instantiate = async function(moduleOrBytes, importObject) {
        const result = await originalInstantiate.call(this, moduleOrBytes, importObject);
        const instance = result.instance || result;

        console.log('🏭 WebAssembly.instantiate called!');

        if (instance.exports && instance.exports.memory) {
            const memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
            console.log('   Memory: ' + memSize.toFixed(2) + ' MB');

            if (memSize > 10) {
                console.log('%c✅ PHYSICS WASM FOUND!', 'color: #00ff00; font-weight: bold');

                window.__TS_PML_WASM__ = {
                    instance: instance,
                    exports: instance.exports,
                    memory: instance.exports.memory
                };

                console.log('✅ Exposed via window.__TS_PML_WASM__');
            }
        }

        return result;
    };

    console.log('✅ WebAssembly hook installed!');
    console.log('   Start driving - WASM will be captured when physics loads!');

    window.__TS_PML_WASM_HOOKS_INSTALLED__ = true;
})();

/**
 * Paste THIS in console - no async/await issues!
 */

(function() {
    if (window.__TS_PML_WASM_HOOKS_INSTALLED__) {
        console.log('Already installed!');
        return;
    }

    console.log('Installing WASM hooks...');

    var originalFetch = window.fetch;

    window.fetch = function(url, options) {
        var urlStr = typeof url === 'string' ? url : url.url;

        if (urlStr && urlStr.includes('polytrack_physics.wasm')) {
            console.log('Intercepting WASM...');

            return originalFetch(url, options).then(function(response) {
                var cloned = response.clone();

                cloned.arrayBuffer().then(function(buffer) {
                    console.log('WASM captured:', buffer.byteLength, 'bytes');

                    window.__CAPTURED_WASM__ = {
                        buffer: buffer,
                        uint8Array: new Uint8Array(buffer)
                    };

                    console.log('Stored in window.__CAPTURED_WASM__');
                });

                return response;
            });
        }

        return originalFetch(url, options);
    };

    console.log('Fetch hook OK');

    var originalInstantiate = WebAssembly.instantiate;

    WebAssembly.instantiate = function(module, importObject) {
        return originalInstantiate.call(this, module, importObject).then(function(result) {
            var instance = result.instance || result;

            console.log('WebAssembly.instantiate called');

            if (instance.exports && instance.exports.memory) {
                var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                console.log('Memory: ' + memSize.toFixed(2) + ' MB');

                if (memSize > 10) {
                    console.log('%c✅ PHYSICS WASM!', 'color: #0f0; font-weight: bold');

                    window.__TS_PML_WASM__ = {
                        instance: instance,
                        exports: instance.exports,
                        memory: instance.exports.memory
                    };

                    console.log('Exposed via window.__TS_PML_WASM__');
                }
            }

            return result;
        });
    };

    console.log('WebAssembly hook OK');
    console.log('Start driving to capture WASM!');

    window.__TS_PML_WASM_HOOKS_INSTALLED__ = true;
})();

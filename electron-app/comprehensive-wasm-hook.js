/**
 * Comprehensive WASM hook - catches ALL methods!
 */

(function() {
    if (window.__TS_PML_WASM_HOOKS_INSTALLED__) {
        console.log('Already installed!');
        return;
    }

    console.log('%c🔧 Installing ULTIMATE WASM hooks...', 'color: #ff0; font-size: 14px');

    // Hook fetch
    var originalFetch = window.fetch;
    window.fetch = function(url, options) {
        var urlStr = typeof url === 'string' ? url : url.url;

        console.log('📡 Fetch:', urlStr);

        if (urlStr && urlStr.includes('.wasm')) {
            console.log('%c🎯 WASM FILE REQUESTED!', 'color: #f0f');

            return originalFetch(url, options).then(function(response) {
                console.log('   Status:', response.status);

                var cloned = response.clone();
                cloned.arrayBuffer().then(function(buffer) {
                    console.log('%c✅ WASM BINARY:', buffer.byteLength, 'bytes', 'color: #0f0');

                    window.__CAPTURED_WASM__ = {
                        buffer: buffer,
                        uint8Array: new Uint8Array(buffer)
                    };
                });

                return response;
            });
        }

        return originalFetch(url, options);
    };

    // Hook WebAssembly.instantiate
    var originalInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = function(module, importObject) {
        console.log('%c🏭 instantiate called', 'color: #0ff');

        return originalInstantiate.call(this, module, importObject).then(function(result) {
            var instance = result.instance || result;

            if (instance.exports && instance.exports.memory) {
                var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                console.log('   Memory: ' + memSize.toFixed(2) + ' MB');

                if (memSize > 10) {
                    console.log('%c✅✅✅ PHYSICS WASM FOUND! ✅✅✅', 'color: #0f0; font-size: 16px; font-weight: bold');

                    window.__TS_PML_WASM__ = {
                        instance: instance,
                        exports: instance.exports,
                        memory: instance.exports.memory
                    };

                    console.log('%c✅ Access via: window.__TS_PML_WASM__', 'color: #0f0');
                }
            }

            return result;
        });
    };

    // Hook WebAssembly.instantiateStreaming (IMPORTANT!)
    if (WebAssembly.instantiateStreaming) {
        var originalIS = WebAssembly.instantiateStreaming;
        WebAssembly.instantiateStreaming = function(response, importObject) {
            console.log('%c🏭 instantiateStreaming called', 'color: #0ff');

            return originalIS.call(this, response, importObject).then(function(result) {
                var instance = result.instance || result;

                if (instance.exports && instance.exports.memory) {
                    var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                    console.log('   Memory: ' + memSize.toFixed(2) + ' MB');

                    if (memSize > 10) {
                        console.log('%c✅✅✅ PHYSICS WASM FOUND (streaming)! ✅✅✅', 'color: #0f0; font-size: 16px; font-weight: bold');

                        window.__TS_PML_WASM__ = {
                            instance: instance,
                            exports: instance.exports,
                            memory: instance.exports.memory
                        };

                        console.log('%c✅ Access via: window.__TS_PML_WASM__', 'color: #0f0');
                    }
                }

                return result;
            });
        };
        console.log('✅ instantiateStreaming hook installed');
    }

    // Hook WebAssembly.compile
    if (WebAssembly.compile) {
        var originalCompile = WebAssembly.compile;
        WebAssembly.compile = function(buffer) {
            console.log('%c🏭 compile called -', buffer.byteLength, 'bytes', 'color: #0ff');
            return originalCompile.call(this, buffer);
        };
    }

    console.log('%c✅ ALL HOOKS INSTALLED!', 'color: #0f0; font-weight: bold');
    console.log('%c   Start driving - watch for colored messages!', 'color: #ff0');

    window.__TS_PML_WASM_HOOKS_INSTALLED__ = true;

    // Also log every 5 seconds to show we're alive
    var interval = setInterval(function() {
        console.log('⏰ Hooks still active... (waiting for WASM load)');
    }, 5000);

    window.__TS_PML_HOOK_INTERVAL__ = interval;
})();

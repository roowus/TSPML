/**
 * Worker WASM Interception Code
 * This gets injected into workers to hook WASM loading
 */

console.log('🔧 TS PML Worker: Installing WASM hooks...');

// Hook WebAssembly.instantiate
const _inst = WebAssembly.instantiate;
WebAssembly.instantiate = function(module, importObject) {
    console.log('🏭 Worker: instantiate called');

    return _inst.call(this, module, importObject).then(function(result) {
        const instance = result.instance || result;

        if (instance.exports && instance.exports.memory) {
            const memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
            console.log('   Memory:', memSize.toFixed(2), 'MB');

            // Check if this is the physics WASM (large memory)
            if (memSize > 10) {
                console.log('%c✅✅✅ WORKER PHYSICS WASM FOUND! ✅✅✅', 'color: #0f0; font-size: 16px; font-weight: bold');

                // Store in worker context
                self.__TS_PML_WASM__ = {
                    instance: instance,
                    exports: instance.exports,
                    memory: instance.exports.memory
                };

                // Create clean API for reading/writing WASM memory
                self.__TS_PML_MEMORY__ = instance.exports.memory;
                self.__TS_PML_VIEW__ = new DataView(instance.exports.memory.buffer);

                console.log('%c✅ WASM exposed to worker as self.__TS_PML_WASM__', 'color: #0f0');

                // Notify main thread
                self.postMessage({
                    type: '__TS_PML_WASM_READY__',
                    wasm: {
                        exports: Object.keys(instance.exports),
                        memorySize: memSize
                    }
                });

                // Listen for commands from main thread
                self.addEventListener('message', function(event) {
                    if (event.data && event.data.type === '__TS_PML_MEMORY_READ__') {
                        const offset = event.data.offset;
                        const type = event.data.type || 'float32';

                        let value;
                        if (type === 'float32') {
                            value = self.__TS_PML_VIEW__.getFloat32(offset, true);
                        } else if (type === 'float64') {
                            value = self.__TS_PML_VIEW__.getFloat64(offset, true);
                        } else if (type === 'int32') {
                            value = self.__TS_PML_VIEW__.getInt32(offset, true);
                        } else if (type === 'uint32') {
                            value = self.__TS_PML_VIEW__.getUint32(offset, true);
                        }

                        self.postMessage({
                            type: '__TS_PML_MEMORY_VALUE__',
                            offset: offset,
                            value: value,
                            requestType: type
                        });
                    }

                    if (event.data && event.data.type === '__TS_PML_MEMORY_WRITE__') {
                        const offset = event.data.offset;
                        const value = event.data.value;
                        const type = event.data.type || 'float32';

                        if (type === 'float32') {
                            self.__TS_PML_VIEW__.setFloat32(offset, value, true);
                        } else if (type === 'float64') {
                            self.__TS_PML_VIEW__.setFloat64(offset, value, true);
                        } else if (type === 'int32') {
                            self.__TS_PML_VIEW__.setInt32(offset, value, true);
                        } else if (type === 'uint32') {
                            self.__TS_PML_VIEW__.setUint32(offset, value, true);
                        }

                        console.log('WASM memory write:', offset, '=', value);

                        self.postMessage({
                            type: '__TS_PML_MEMORY_WRITTEN__',
                            offset: offset,
                            value: value
                        });
                    }
                });
            }
        }

        return result;
    });
};

// Hook WebAssembly.instantiateStreaming
if (WebAssembly.instantiateStreaming) {
    const _is = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = function(response, importObject) {
        console.log('🏭 Worker: instantiateStreaming called');

        return _is.call(this, response, importObject).then(function(result) {
            const instance = result.instance || result;

            if (instance.exports && instance.exports.memory) {
                const memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                console.log('   Memory:', memSize.toFixed(2), 'MB');

                if (memSize > 10) {
                    console.log('%c✅✅✅ WORKER PHYSICS WASM (streaming)! ✅✅✅', 'color: #0f0; font-size: 16px; font-weight: bold');

                    self.__TS_PML_WASM__ = {
                        instance: instance,
                        exports: instance.exports,
                        memory: instance.exports.memory
                    };

                    self.__TS_PML_MEMORY__ = instance.exports.memory;
                    self.__TS_PML_VIEW__ = new DataView(instance.exports.memory.buffer);

                    self.postMessage({
                        type: '__TS_PML_WASM_READY__',
                        wasm: {
                            exports: Object.keys(instance.exports),
                            memorySize: memSize
                        }
                    });
                }
            }

            return result;
        });
    });
}

console.log('✅ TS PML Worker: WASM hooks installed!');

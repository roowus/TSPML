// Minimal worker WASM hook - no template literals, simple strings only
(function() {
  console.log('TS PML Worker hook installing');

  var originalInstantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = function(module, importObject) {
    console.log('Worker: WASM instantiate called');
    return originalInstantiate.call(this, module, importObject).then(function(result) {
      var instance = result.instance || result;
      console.log('Worker: WASM instantiate promise resolved');

      if (instance.exports) {
        console.log('Worker: WASM has exports:', Object.keys(instance.exports).slice(0, 5));

        if (instance.exports.memory) {
          var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
          console.log('Worker: WASM memory ' + memSize.toFixed(2) + ' MB');

          if (memSize > 10) {
            console.log('%c✅✅✅ WORKER PHYSICS WASM FOUND! ✅✅✅');
            self.__TS_PML_WASM__ = {
              instance: instance,
              exports: instance.exports,
              memory: instance.exports.memory
            };
            self.__TS_PML_VIEW__ = new DataView(instance.exports.memory.buffer);
            self.postMessage({
              type: '__TS_PML_WASM_READY__',
              wasm: {
                exports: Object.keys(instance.exports),
                memorySize: memSize
              }
            });
          } else {
            console.log('Worker: Small WASM (not physics)');
          }
        } else {
          console.log('Worker: WASM has no memory export');
        }
      } else {
        console.log('Worker: WASM has no exports');
      }

      return result;
    }).catch(function(err) {
      console.error('Worker: WASM instantiate error:', err);
      throw err;
    });
  };

  if (WebAssembly.instantiateStreaming) {
    var originalIS = WebAssembly.instantiateStreaming;
    WebAssembly.instantiateStreaming = function(response, importObject) {
      console.log('Worker: WASM instantiateStreaming called');
      return originalIS.call(this, response, importObject).then(function(result) {
        var instance = result.instance || result;
        console.log('Worker: WASM instantiateStreaming promise resolved');

        if (instance.exports) {
          console.log('Worker: Streaming WASM has exports:', Object.keys(instance.exports).slice(0, 5));

          if (instance.exports.memory) {
            var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
            console.log('Worker: Streaming WASM memory ' + memSize.toFixed(2) + ' MB');

            if (memSize > 10) {
              console.log('%c✅✅✅ WORKER PHYSICS WASM FOUND (streaming)! ✅✅✅');
              self.__TS_PML_WASM__ = {
                instance: instance,
                exports: instance.exports,
                memory: instance.exports.memory
              };
              self.__TS_PML_VIEW__ = new DataView(instance.exports.memory.buffer);
              self.postMessage({
                type: '__TS_PML_WASM_READY__',
                wasm: {
                  exports: Object.keys(instance.exports),
                  memorySize: memSize
                }
              });
            } else {
              console.log('Worker: Small streaming WASM (not physics)');
            }
          } else {
            console.log('Worker: Streaming WASM has no memory export');
          }
        } else {
          console.log('Worker: Streaming WASM has no exports');
        }

        return result;
      }).catch(function(err) {
        console.error('Worker: WASM instantiateStreaming error:', err);
        throw err;
      });
    };
    console.log('Worker: instantiateStreaming hook installed');
  }
})();

// Preload script with Node.js access - capture real WASM from server
const fs = require('fs');
const path = require('path');

console.log('=== PRELOAD SCRIPT STARTED ===');

// Path to save/serve physics WASM
const physicsWasmPath = path.join(__dirname, 'lib', 'polytrack_physics.wasm');
let physicsWasmDataUrl = null;

// Check if we have a cached WASM file that looks like the real one (> 1MB)
let cachedWasmBuffer = null;
if (fs.existsSync(physicsWasmPath)) {
  cachedWasmBuffer = fs.readFileSync(physicsWasmPath);
  console.log('=== PRELOAD: Cached WASM found ===', cachedWasmBuffer.length, 'bytes');

  if (cachedWasmBuffer.length > 1000000) { // > 1MB likely the real one
    const wasmBase64 = cachedWasmBuffer.toString('base64');
    physicsWasmDataUrl = 'data:application/wasm;base64,' + wasmBase64;
    console.log('=== PRELOAD: Using cached WASM data URL ===', physicsWasmDataUrl.length);
  } else {
    console.log('=== PRELOAD: Cached WASM too small, will capture from server ===');
  }
} else {
  console.log('=== PRELOAD: No cached WASM, will capture from server ===');
}

// Hook Worker constructor
const originalWorker = window.Worker;
window.Worker = function(scriptURL, options) {
  if (typeof scriptURL === 'string' && scriptURL.includes('simulation_worker.bundle.js')) {
    console.log('=== PRELOAD: SIMULATION WORKER ===');

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', scriptURL, false);
      xhr.send();

      if (xhr.status === 200) {
        let workerCode = xhr.responseText;
        console.log('=== PRELOAD: Got worker code ===', workerCode.length);

        // Fix importScripts paths
        const baseURL = 'https://app-polytrack.kodub.com/0.6.0/';
        workerCode = workerCode.replace(
          /importScripts\(['"`]([^'"`]+)['"`]\)/g,
          function(match, relativePath) {
            if (relativePath.startsWith('http') || relativePath.startsWith('//')) {
              return match;
            }
            const absolutePath = baseURL + relativePath;
            return "importScripts('" + absolutePath + "')";
          }
        );
        console.log('=== PRELOAD: importScripts fixed ===');

        // Create worker hooks that intercept and save WASM
        const workerHooksCode = '(' + function() {
          console.log('TS PML Worker hook installing');

          // Store car state data
          self.__TS_PML_CAR_STATE__ = null;
          self.__TS_PML_CAR_STATE_BUFFER__ = null;

          // 🔧 MALLOC HOOK: Capture car state buffer address from malloc(227) calls
          // Poll for Module to become available (created when WASM loads)
          var moduleCheckInterval = setInterval(function() {
            if (self.Module && self.Module.ccall && !self.__TS_PML_CCALL_HOOKED__) {
              console.log('🔧 [TS-PML] Module found, installing ccall hook...');

              var originalCcall = self.Module.ccall.bind(self.Module);
              self.Module.ccall = function(name, returnType, argTypes, args) {
                var result = originalCcall(name, returnType, argTypes, args);

                // Capture malloc(227) calls - this allocates the car state buffer
                if (name === 'malloc' && args && args[0] === 227) {
                  self.__TS_PML_CAR_STATE_BUFFER__ = result;
                  console.log('🔧 [TS-PML] Captured car state buffer address: 0x' + result.toString(16));

                  // Notify main thread
                  self.postMessage({
                    type: '__TS_PML_CAR_STATE_BUFFER_READY__',
                    bufferAddress: result
                  });
                }

                return result;
              };

              self.__TS_PML_CCALL_HOOKED__ = true;
              clearInterval(moduleCheckInterval);
              console.log('🔧 [TS-PML] ccall hook installed');
            }
          }, 100);  // Check every 100ms

          // Also set up a MutationObserver-like check for delayed Module loading
          setTimeout(function() {
            clearInterval(moduleCheckInterval);
            if (!self.__TS_PML_CCALL_HOOKED__) {
              console.log('⚠️ [TS-PML] Module not found after 10 seconds, malloc hook may not work');
            }
          }, 10000);  // Timeout after 10 seconds

          // Hook postMessage to intercept car state buffers sent to main thread
          var originalPostMessage = self.postMessage;
          var messageCount = 0;
          self.postMessage = function(message, transfer) {
            messageCount++;

            // Debug: Log first 100 messages to understand format (DISABLED to reduce spam)
            // if (messageCount <= 100) {
            //   console.log('🔍 TS PML: postMessage #' + messageCount, typeof message, Object.keys(message || {}).slice(0, 10));
            // }

            // Check if this is an UpdateResult message with carStateBuffers
            if (message && typeof message === 'object') {
              // Try to detect UpdateResult - might be a numeric constant or string
              var messageType = message.messageType;
              var hasCarState = message.carStateBuffers && message.carStateBuffers.length > 0;
              var hasBuffers = message.buffers && message.buffers.length > 0;
              var hasData = message.data && message.data.length > 0;

              // Log any message with potentially interesting structure (DISABLED to reduce spam)
              // if (messageCount <= 100 && (messageType || hasCarState || hasBuffers || hasData)) {
              //   console.log('🔍 TS PML: Interesting message - type:', messageType, 'hasCarState:', hasCarState, 'hasBuffers:', hasBuffers, 'hasData:', hasData);
              // }

              if (hasCarState) {
                // Track player by POSITION data, not array index (since array reorders every frame)
                if (!self.__TS_PML_CAR_TRACKER__) {
                  self.__TS_PML_CAR_TRACKER__ = {
                    trackedPosZ: null,      // Track by position.z value
                    frameCount: 0,
                    initialized: false
                  };
                }
                self.__TS_PML_CAR_TRACKER__.frameCount++;

                var candidates = [];

                // Find all valid cars
                for (var carIndex = 0; carIndex < message.carStateBuffers.length; carIndex++) {
                  var buffer = message.carStateBuffers[carIndex];
                  if (buffer instanceof ArrayBuffer && buffer.byteLength >= 64) {
                    var bytes = new Uint8Array(buffer.slice(0, 64));
                    var view = new DataView(bytes.buffer);

                    var speed = view.getFloat32(4, true);
                    var posX = view.getFloat32(35, true);
                    var posZ = view.getFloat32(43, true);

                    // Strict validity check
                    if (Math.abs(posZ) <= 500 && Math.abs(posX) <= 100 &&
                        speed === speed && Math.abs(speed) <= 200) {
                      candidates.push({
                        index: carIndex,
                        speed: speed,
                        posX: posX,
                        posZ: posZ
                      });
                    }
                  }
                }

                if (candidates.length === 0) {
                  // No valid cars - skip this frame
                  return;
                }

                var selectedIndex = -1;
                var switched = false;

                if (!self.__TS_PML_CAR_TRACKER__.initialized) {
                  // First frame: pick the first valid car
                  selectedIndex = candidates[0].index;
                  self.__TS_PML_CAR_TRACKER__.trackedPosZ = candidates[0].posZ;
                  self.__TS_PML_CAR_TRACKER__.initialized = true;
                  switched = true;
                  console.log('🔒 TS PML: Initial track at z=' + candidates[0].posZ.toFixed(1) + ' (index=' + selectedIndex + ')');
                } else {
                  // Find car with position.z closest to our tracked position
                  var bestIndex = -1;
                  var bestDeltaZ = Infinity;

                  for (var i = 0; i < candidates.length; i++) {
                    var deltaZ = Math.abs(candidates[i].posZ - self.__TS_PML_CAR_TRACKER__.trackedPosZ);
                    if (deltaZ < bestDeltaZ) {
                      bestDeltaZ = deltaZ;
                      bestIndex = i;
                    }
                  }

                  // Only switch if position changed significantly (car is moving)
                  // OR if we found a car very close to our tracked position
                  if (bestIndex >= 0) {
                    var bestCandidate = candidates[bestIndex];

                    // Update tracked position smoothly (follow the car as it moves)
                    var oldPosZ = self.__TS_PML_CAR_TRACKER__.trackedPosZ;
                    var newPosZ = bestCandidate.posZ;
                    var posChange = Math.abs(newPosZ - oldPosZ);

                    // Allow smooth position tracking (car can move up to 50 units per frame)
                    if (posChange < 50) {
                      selectedIndex = bestCandidate.index;
                      self.__TS_PML_CAR_TRACKER__.trackedPosZ = newPosZ;

                      if (posChange > 1) {
                        // Log significant position changes
                        console.log('📍 TS PML: Car moved z=' + oldPosZ.toFixed(1) + ' → ' + newPosZ.toFixed(1) +
                                    ' (index=' + selectedIndex + ')');
                      }
                    } else {
                      // Large position jump - possible respawn or teleport
                      selectedIndex = bestCandidate.index;
                      self.__TS_PML_CAR_TRACKER__.trackedPosZ = newPosZ;
                      console.log('🔄 TS PML: Position jump z=' + oldPosZ.toFixed(1) + ' → ' + newPosZ.toFixed(1) +
                                  ' (index=' + selectedIndex + ')');
                    }
                  }
                }

                if (selectedIndex >= 0) {
                  // Store car state
                  var stateBuffer = message.carStateBuffers[selectedIndex];
                  self.__TS_PML_CAR_STATE__ = new Uint8Array(stateBuffer.slice(0));

                  // CONTROL INPUT TEST MODE: Compact hex dump for easy diffing
                  // Output format: "CTRL: 00 01 02... (227 bytes total)"
                  var hexLine = 'CTRL: ';
                  for (var b = 0; b < 227; b++) {
                    var byte = self.__TS_PML_CAR_STATE__[b];
                    hexLine += (byte < 16 ? '0' : '') + byte.toString(16) + ' ';
                    if ((b + 1) % 32 === 0) hexLine += '\n      ';
                  }
                  console.log(hexLine);

                  // Also show human-readable fields for reference
                  var view = new DataView(self.__TS_PML_CAR_STATE__.buffer);
                  var speed = view.getFloat32(4, true);
                  var posZ = view.getFloat32(43, true);
                  var heading = view.getFloat32(51, true);
                  console.log('📊 REF: speed=' + speed.toFixed(1) + ' posZ=' + posZ.toFixed(1) + ' heading=' + heading.toFixed(1));

                  // Send to main thread (rate limited)
                  if (!self.__TS_PML_LAST_SENT__ || Date.now() - self.__TS_PML_LAST_SENT__ > 500) {
                    self.__TS_PML_LAST_SENT__ = Date.now();

                    var hex = '';
                    for (var j = 0; j < Math.min(self.__TS_PML_CAR_STATE__.length, 227); j++) {
                      hex += (self.__TS_PML_CAR_STATE__[j] < 16 ? '0' : '') + self.__TS_PML_CAR_STATE__[j].toString(16) + ' ';
                      if ((j + 1) % 16 === 0) hex += '\n';
                    }

                    setTimeout(function() {
                      originalPostMessage.call(self, {
                        type: '__TS_PML_CAR_STATE_READY__',
                        carState: hex,
                        carIndex: selectedIndex
                      });
                    }, 0);
                  }
                }
              }
            }

            // Call original postMessage
            return originalPostMessage.call(this, message, transfer);
          };
          console.log('✅ TS PML: postMessage hook installed');

          // Listen for memory read/write requests from main thread
          self.addEventListener('message', function(event) {
            if (!event.data || !event.data.type) return;

            var data = event.data;

            // Debug: Log all message types
            if (data.type.startsWith('__TS_PML_')) {
              console.log('Worker: Received message:', data.type);
            }

            // Handle memory read requests
            if (data.type === '__TS_PML_MEMORY_READ__') {
              if (!self.__TS_PML_WASM__) {
                setTimeout(function() {
                  self.postMessage({ type: '__TS_PML_MEMORY_RESPONSE__', id: data.id, error: 'WASM not ready' });
                }, 0);
                return;
              }

              var memory = self.__TS_PML_WASM__.memory;
              var view = new DataView(memory.buffer);
              var result;

              switch (data.dataType) {
                case 'float32':
                  result = view.getFloat32(data.offset, true);
                  break;
                case 'float64':
                  result = view.getFloat64(data.offset, true);
                  break;
                case 'int32':
                  result = view.getInt32(data.offset, true);
                  break;
                case 'uint32':
                  result = view.getUint32(data.offset, true);
                  break;
                default:
                  result = view.getUint8(data.offset);
              }

              var msgId = data.id;
              var msgValue = result;
              setTimeout(function() {
                self.postMessage({
                  type: '__TS_PML_MEMORY_RESPONSE__',
                  id: msgId,
                  value: msgValue
                });
              }, 0);
            }

            // Handle memory write requests
            if (data.type === '__TS_PML_MEMORY_WRITE__') {
              if (!self.__TS_PML_WASM__) {
                setTimeout(function() {
                  self.postMessage({ type: '__TS_PML_MEMORY_RESPONSE__', id: data.id, error: 'WASM not ready' });
                }, 0);
                return;
              }

              var memory = self.__TS_PML_WASM__.memory;
              var view = new DataView(memory.buffer);

              switch (data.dataType) {
                case 'float32':
                  view.setFloat32(data.offset, data.value, true);
                  break;
                case 'float64':
                  view.setFloat64(data.offset, data.value, true);
                  break;
                case 'int32':
                  view.setInt32(data.offset, data.value, true);
                  break;
                case 'uint32':
                  view.setUint32(data.offset, data.value, true);
                  break;
                default:
                  view.setUint8(data.offset, data.value);
              }

              var msgId = data.id;
              setTimeout(function() {
                self.postMessage({
                  type: '__TS_PML_MEMORY_RESPONSE__',
                  id: msgId,
                  success: true
                });
              }, 0);
            }

            // Handle memory chunk read
            if (data.type === '__TS_PML_MEMORY_CHUNK__') {
              console.log('Worker: Handling MEMORY_CHUNK, WASM ready:', !!self.__TS_PML_WASM__);
              if (!self.__TS_PML_WASM__) {
                console.log('Worker: WASM not ready, sending error');
                setTimeout(function() {
                  self.postMessage({ type: '__TS_PML_MEMORY_RESPONSE__', id: data.id, error: 'WASM not ready' });
                }, 0);
                return;
              }

              console.log('Worker: Reading memory chunk, offset:', data.offset, 'length:', data.length);
              var memory = self.__TS_PML_WASM__.memory;
              console.log('Worker: Memory buffer size:', memory.buffer.byteLength);
              var bytes = new Uint8Array(memory.buffer, data.offset, data.length);
              var hex = '';
              for (var i = 0; i < Math.min(data.length, 256); i++) {
                hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16) + ' ';
                if ((i + 1) % 16 === 0) hex += '\n';
              }

              console.log('Worker: Sending memory chunk response, hex length:', hex.length);
              // Use setTimeout to ensure postMessage happens outside the current message handler context
              var msgId = data.id;
              var msgChunk = hex;
              setTimeout(function() {
                console.log('Worker: Actually sending message now (after setTimeout)');
                self.postMessage({
                  type: '__TS_PML_MEMORY_RESPONSE__',
                  id: msgId,
                  chunk: msgChunk
                });
                console.log('Worker: Memory chunk response sent (after postMessage)');
              }, 0);
              console.log('Worker: Memory chunk queued for sending');
            }

            // Handle car state buffer read/write
            if (data.type === '__TS_PML_GET_CAR_STATE_BUFFER__') {
              console.log('Worker: GET_CAR_STATE_BUFFER, address:', self.__TS_PML_CAR_STATE_BUFFER__);
              setTimeout(function() {
                self.postMessage({
                  type: '__TS_PML_CAR_STATE_BUFFER__',
                  id: data.id,
                  bufferAddress: self.__TS_PML_CAR_STATE_BUFFER__,
                  hasBuffer: !!self.__TS_PML_CAR_STATE_BUFFER__
                });
              }, 0);
            }

            // Handle car state read (for simulation worker with Module.ccall)
            if (data.type === '__TS_PML_READ_CAR_STATE__') {
              setTimeout(function() {
                if (!self.__TS_PML_CAR_STATE_BUFFER__) {
                  self.postMessage({
                    type: '__TS_PML_CAR_STATE_RESPONSE__',
                    id: data.id,
                    error: 'Car state buffer not found'
                  });
                  return;
                }

                // Read the 227-byte car state buffer
                var buffer = new Uint8Array(self.Module.HEAPU8.buffer, self.__TS_PML_CAR_STATE_BUFFER__, 227);
                var hex = '';
                for (var i = 0; i < buffer.length; i++) {
                  hex += (buffer[i] < 16 ? '0' : '') + buffer[i].toString(16) + ' ';
                  if ((i + 1) % 16 === 0) hex += '\n';
                }

                console.log('Worker: Car state buffer read, 227 bytes');
                self.postMessage({
                  type: '__TS_PML_CAR_STATE_RESPONSE__',
                  id: data.id,
                  buffer: hex,
                  bufferAddress: self.__TS_PML_CAR_STATE_BUFFER__
                });
              }, 0);
            }

            // Handle car state write (modify actual physics state!)
            if (data.type === '__TS_PML_WRITE_CAR_STATE__') {
              setTimeout(function() {
                if (!self.__TS_PML_CAR_STATE_BUFFER__) {
                  self.postMessage({
                    type: '__TS_PML_CAR_STATE_RESPONSE__',
                    id: data.id,
                    error: 'Car state buffer not found'
                  });
                  return;
                }

                // Parse hex data and write to buffer
                var hex = data.data.replace(/\s+/g, '');
                for (var i = 0; i < Math.min(hex.length / 2, 227); i++) {
                  var byte = parseInt(hex.substr(i * 2, 2), 16);
                  self.Module.HEAPU8[self.__TS_PML_CAR_STATE_BUFFER__ + i] = byte;
                }

                console.log('Worker: Car state buffer written, ' + (hex.length / 2) + ' bytes');
                self.postMessage({
                  type: '__TS_PML_CAR_STATE_RESPONSE__',
                  id: data.id,
                  success: true
                });
              }, 0);
            }

            // Apply physics writes from shared queue (simpler API)
            if (data.type === '__TS_PML_APPLY_PHYSICS_WRITES__') {
              setTimeout(function() {
                if (!self.__TS_PML_CAR_STATE_BUFFER__) {
                  console.log('⚠️ [TS-PML] Car state buffer not found for physics write');
                  return;
                }

                // Get writes from shared storage (passed via message data since workers can't access main thread globals directly)
                var writes = data.writes;
                if (!writes) {
                  console.log('⚠️ [TS-PML] No writes provided');
                  return;
                }

                var bufferAddr = self.__TS_PML_CAR_STATE_BUFFER__;
                var modified = false;

                // Apply position writes
                if (writes.position) {
                  self.Module.HEAPF32[bufferAddr / 4 + 8] = writes.position.x;   // offset 35 (byte 140) / 4 = word 35
                  self.Module.HEAPF32[bufferAddr / 4 + 9] = writes.position.y;   // offset 39
                  self.Module.HEAPF32[bufferAddr / 4 + 10] = writes.position.z;  // offset 43
                  console.log('📝 [TS-PML] Position physics write:', writes.position);
                  modified = true;
                }

                // Apply speed write
                if (writes.speed !== undefined && writes.speed !== null) {
                  self.Module.HEAPF32[bufferAddr / 4 + 1] = writes.speed;  // offset 4 (word 1)
                  console.log('📝 [TS-PML] Speed physics write:', writes.speed);
                  modified = true;
                }

                // Apply rotation writes
                if (writes.rotation) {
                  self.Module.HEAPF32[bufferAddr / 4 + 11] = writes.rotation.x;  // offset 47 (word ~12)
                  self.Module.HEAPF32[bufferAddr / 4 + 12] = writes.rotation.y;  // offset 51
                  self.Module.HEAPF32[bufferAddr / 4 + 13] = writes.rotation.z;  // offset 55
                  self.Module.HEAPF32[bufferAddr / 4 + 14] = writes.rotation.w;  // offset 59
                  console.log('📝 [TS-PML] Rotation physics write:', writes.rotation);
                  modified = true;
                }

                if (modified) {
                  self.postMessage({
                    type: '__TS_PML_PHYSICS_WRITE_COMPLETE__',
                    success: true
                  });
                }
              }, 0);
            }
          });

          var HAS_CACHED_WASM = '__HAS_CACHED_WASM__' === 'true';
          var PHYSICS_WASM_DATA_URL = '__PHYSICS_WASM_DATA_URL__';

          // If we have cached WASM, redirect to data URL
          if (HAS_CACHED_WASM) {
            console.log('Worker: Using cached physics WASM data URL');

            var originalFetch = self.fetch;
            self.fetch = function(url, options) {
              if (typeof url === 'string' && url.includes('polytrack_physics.wasm')) {
                console.log('Worker: Redirecting to cached WASM data URL');
                return originalFetch.call(self, PHYSICS_WASM_DATA_URL, options);
              }
              return originalFetch.call(self, url, options);
            };

            var originalXHR = self.XMLHttpRequest;
            self.XMLHttpRequest = function() {
              var xhr = new originalXHR();
              var originalOpen = xhr.open;
              xhr.open = function(method, url, ...args) {
                if (typeof url === 'string' && url.includes('polytrack_physics.wasm')) {
                  console.log('Worker: XHR redirecting to cached WASM data URL');
                  return originalOpen.call(this, method, PHYSICS_WASM_DATA_URL, ...args);
                }
                return originalOpen.call(this, method, url, ...args);
              };
              return xhr;
            };
          } else {
            console.log('Worker: Will capture physics WASM from server');

            // Intercept fetch to capture WASM, then let it load normally
            var originalFetch = self.fetch;
            self.fetch = function(url, options) {
              if (typeof url === 'string' && url.includes('polytrack_physics.wasm')) {
                console.log('Worker: Fetching physics WASM from server');

                // Convert relative URL to absolute URL
                var absoluteUrl = url;
                if (!url.startsWith('http') && !url.startsWith('//')) {
                  // Worker is loaded from https://app-polytrack.kodub.com/0.6.0/lib/
                  // So polytrack_physics.wasm should be:
                  absoluteUrl = 'https://app-polytrack.kodub.com/0.6.0/lib/polytrack_physics.wasm';
                  if (url.startsWith('lib/')) {
                    absoluteUrl = 'https://app-polytrack.kodub.com/0.6.0/' + url;
                  }
                }

                console.log('Worker: Converted to absolute URL:', absoluteUrl);

                // Let the fetch proceed normally, but clone the response to capture it
                var originalPromise = originalFetch.call(self, absoluteUrl, options);

                // Intercept the response to capture the WASM
                var interceptedPromise = originalPromise.then(function(response) {
                  // Clone the response so we can read it without affecting the original
                  var clonedResponse = response.clone();

                  // Read and save the WASM
                  clonedResponse.arrayBuffer().then(function(buffer) {
                    console.log('Worker: Captured WASM from server:', buffer.byteLength, 'bytes');
                    self.postMessage({
                      type: '__TS_PML_SAVE_WASM__',
                      wasmBuffer: new Uint8Array(buffer)
                    });
                  }).catch(function(err) {
                    console.error('Worker: Failed to capture WASM:', err);
                  });

                  // Return the original response
                  return response;
                });

                return interceptedPromise;
              }
              return originalFetch.call(self, url, options);
            };

            // Intercept XHR to capture WASM
            var originalXHR = self.XMLHttpRequest;
            self.XMLHttpRequest = function() {
              var xhr = new originalXHR();
              var wasmUrl = null;

              var originalOpen = xhr.open;
              xhr.open = function(method, url, ...args) {
                if (typeof url === 'string' && url.includes('polytrack_physics.wasm')) {
                  wasmUrl = url;
                  console.log('Worker: XHR opening physics WASM request');

                  // Convert relative URL to absolute URL
                  var absoluteUrl = url;
                  if (!url.startsWith('http') && !url.startsWith('//')) {
                    absoluteUrl = 'https://app-polytrack.kodub.com/0.6.0/lib/polytrack_physics.wasm';
                    if (url.startsWith('lib/')) {
                      absoluteUrl = 'https://app-polytrack.kodub.com/0.6.0/' + url;
                    }
                  }
                  console.log('Worker: XHR converted to absolute URL:', absoluteUrl);

                  // Set response type to array buffer
                  xhr.responseType = 'arraybuffer';
                  return originalOpen.call(this, method, absoluteUrl, ...args);
                }
                return originalOpen.call(this, method, url, ...args);
              };

              // Set up event listener to capture response
              xhr.addEventListener('load', function() {
                if (wasmUrl && xhr.status === 200) {
                  var buffer = xhr.response;
                  if (buffer && buffer.byteLength > 1000000) {
                    console.log('Worker: XHR captured physics WASM:', buffer.byteLength, 'bytes');
                    self.postMessage({
                      type: '__TS_PML_SAVE_WASM__',
                      wasmBuffer: new Uint8Array(buffer)
                    });
                  }
                }
              });

              return xhr;
            };
          }

          // Hook WebAssembly.instantiate to capture ALL WASM
          var originalInstantiate = WebAssembly.instantiate;
          WebAssembly.instantiate = function(module, importObject) {
            return originalInstantiate.call(this, module, importObject).then(function(result) {
              var instance = result.instance || result;
              if (instance.exports && instance.exports.memory) {
                var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                console.log('Worker: WASM instantiate memory ' + memSize.toFixed(2) + ' MB');

                // This is the physics WASM! Capture the instance exports
                console.log('%c✅✅✅ WORKER PHYSICS WASM FOUND! ✅✅✅');
                self.__TS_PML_WASM__ = {
                  instance: instance,
                  exports: instance.exports,
                  memory: instance.exports.memory
                };

                // Create memory read/write API
                self.__TS_PML_MEMORY__ = {
                  buffer: instance.exports.memory.buffer,

                  readFloat32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getFloat32(offset, true);
                  },

                  readFloat64: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getFloat64(offset, true);
                  },

                  readInt32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getInt32(offset, true);
                  },

                  readUInt32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getUint32(offset, true);
                  },

                  writeFloat32: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setFloat32(offset, value, true);
                  },

                  writeFloat64: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setFloat64(offset, value, true);
                  },

                  writeInt32: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setInt32(offset, value, true);
                  },

                  readChunk: function(offset, length) {
                    var bytes = new Uint8Array(instance.exports.memory.buffer, offset, length);
                    var hex = '';
                    for (var i = 0; i < Math.min(length, 256); i++) {
                      hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16) + ' ';
                      if ((i + 1) % 16 === 0) hex += '\n';
                    }
                    return hex;
                  }
                };

                console.log('Worker: Memory read/write API installed');

                // 🔍 INTERCEPT WASM FUNCTION CALLS to find control inputs
                console.log('%c🔍 WASM EXPORTS: ' + Object.keys(instance.exports).length + ' functions', 'color: #ff6b6b');
                var exportNames = Object.keys(instance.exports);
                var suspiciousFunctions = [];
                var callCount = 0;

                for (var i = 0; i < exportNames.length; i++) {
                  var name = exportNames[i];
                  var func = instance.exports[name];

                  // Look for control-related function names
                  if (typeof func === 'function') {
                    var nameLower = name.toLowerCase();
                    var isControlRelated = nameLower.includes('input') || nameLower.includes('control') ||
                                          nameLower.includes('key') || nameLower.includes('press') ||
                                          nameLower.includes('steer') || nameLower.includes('accel') ||
                                          nameLower.includes('throttle') || nameLower.includes('brake') ||
                                          nameLower.includes('drive') || nameLower.includes('player');

                    if (isControlRelated) {
                      suspiciousFunctions.push(name);
                    }

                    // Wrap ALL functions to log their calls (with rate limiting)
                    (function(funcName, originalFunc, isCtrl) {
                      instance.exports[funcName] = function() {
                        callCount++;
                        var args = Array.prototype.slice.call(arguments);
                        var argsStr = args.map(function(a) {
                          if (typeof a === 'number') {
                            // Float or int - show both interpretations
                            var intVal = a | 0;
                            return a.toFixed(2) + ' (i:' + intVal + ')';
                          } else if (typeof a === 'boolean') {
                            return a ? 'T' : 'F';
                          } else {
                            return typeof a;
                          }
                        }).join(' ');

                        // Log suspicious functions, or sample others
                        if (isCtrl || (callCount % 500 === 0 && args.length <= 4)) {
                          console.log('🎮 WASM[' + callCount + '] ' + funcName + '(' + argsStr + ')');
                        }

                        return originalFunc.apply(this, arguments);
                      };
                    })(name, func, isControlRelated);
                  }
                }

                if (suspiciousFunctions.length > 0) {
                  console.log('%c🎮 SUSPICIOUS: ' + suspiciousFunctions.join(', '), 'color: #ffd93d');
                }

                self.postMessage({
                  type: '__TS_PML_WASM_READY__',
                  wasm: {
                    exports: Object.keys(instance.exports),
                    memorySize: memSize
                  }
                });
              }
              return result;
            });
          };

          // Hook instantiateStreaming to detect physics WASM
          var originalInstantiateStreaming = WebAssembly.instantiateStreaming;
          WebAssembly.instantiateStreaming = function(response, importObject) {
            return originalInstantiateStreaming.call(this, response, importObject).then(function(result) {
              var instance = result.instance || result;
              if (instance.exports && instance.exports.memory) {
                var memSize = instance.exports.memory.buffer.byteLength / 1024 / 1024;
                console.log('Worker: WASM streaming memory ' + memSize.toFixed(2) + ' MB');

                // This is the physics WASM!
                console.log('%c✅✅✅ WORKER PHYSICS WASM FOUND (streaming)! ✅✅✅');
                self.__TS_PML_WASM__ = {
                  instance: instance,
                  exports: instance.exports,
                  memory: instance.exports.memory
                };

                // Create memory read/write API
                self.__TS_PML_MEMORY__ = {
                  buffer: instance.exports.memory.buffer,

                  // Read different types from memory
                  readFloat32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getFloat32(offset, true); // little-endian
                  },

                  readFloat64: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getFloat64(offset, true); // little-endian
                  },

                  readInt32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getInt32(offset, true); // little-endian
                  },

                  readUInt32: function(offset) {
                    var view = new DataView(instance.exports.memory.buffer);
                    return view.getUint32(offset, true); // little-endian
                  },

                  // Write different types to memory
                  writeFloat32: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setFloat32(offset, value, true); // little-endian
                  },

                  writeFloat64: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setFloat64(offset, value, true); // little-endian
                  },

                  writeInt32: function(offset, value) {
                    var view = new DataView(instance.exports.memory.buffer);
                    view.setInt32(offset, value, true); // little-endian
                  },

                  // Read a chunk of memory as hex dump
                  readChunk: function(offset, length) {
                    var bytes = new Uint8Array(instance.exports.memory.buffer, offset, length);
                    var hex = '';
                    for (var i = 0; i < Math.min(length, 256); i++) {
                      hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16) + ' ';
                      if ((i + 1) % 16 === 0) hex += '\n';
                    }
                    return hex;
                  },

                  // Search for a pattern in memory
                  searchPattern: function(pattern, startOffset, endOffset) {
                    var memory = new Uint8Array(instance.exports.memory.buffer);
                    var patternBytes = typeof pattern === 'string' ?
                      pattern.split('').map(c => c.charCodeAt(0)) :
                      pattern;

                    for (var i = startOffset; i < endOffset - patternBytes.length; i++) {
                      var found = true;
                      for (var j = 0; j < patternBytes.length; j++) {
                        if (memory[i + j] !== patternBytes[j]) {
                          found = false;
                          break;
                        }
                      }
                      if (found) return i;
                    }
                    return -1;
                  }
                };

                console.log('Worker: Memory read/write API installed');

                // 🔍 INTERCEPT WASM FUNCTION CALLS (streaming version)
                var exportNames = Object.keys(instance.exports);
                var suspiciousFunctions = [];
                var callCount = 0;

                for (var i = 0; i < exportNames.length; i++) {
                  var name = exportNames[i];
                  var func = instance.exports[name];

                  if (typeof func === 'function') {
                    var nameLower = name.toLowerCase();
                    var isControlRelated = nameLower.includes('input') || nameLower.includes('control') ||
                                          nameLower.includes('key') || nameLower.includes('press') ||
                                          nameLower.includes('steer') || nameLower.includes('accel') ||
                                          nameLower.includes('throttle') || nameLower.includes('brake') ||
                                          nameLower.includes('drive') || nameLower.includes('player');

                    if (isControlRelated) {
                      suspiciousFunctions.push(name);
                    }

                    (function(funcName, originalFunc, isCtrl) {
                      instance.exports[funcName] = function() {
                        callCount++;
                        var args = Array.prototype.slice.call(arguments);
                        var argsStr = args.map(function(a) {
                          if (typeof a === 'number') {
                            var intVal = a | 0;
                            return a.toFixed(2) + ' (i:' + intVal + ')';
                          } else if (typeof a === 'boolean') {
                            return a ? 'T' : 'F';
                          } else {
                            return typeof a;
                          }
                        }).join(' ');

                        if (isCtrl || (callCount % 500 === 0 && args.length <= 4)) {
                          console.log('🎮 WASM[' + callCount + '] ' + funcName + '(' + argsStr + ')');
                        }

                        return originalFunc.apply(this, arguments);
                      };
                    })(name, func, isControlRelated);
                  }
                }

                if (suspiciousFunctions.length > 0) {
                  console.log('%c🎮 SUSPICIOUS: ' + suspiciousFunctions.join(', '), 'color: #ffd93d');
                }

                self.postMessage({
                  type: '__TS_PML_WASM_READY__',
                  wasm: {
                    exports: Object.keys(instance.exports),
                    memorySize: memSize
                  }
                });
              }
              return result;
            });
          };
        }.toString() + ')();\n';

        // Replace placeholders
        const hasCachedWasm = physicsWasmDataUrl !== null;
        const workerHooksWithWasm = workerHooksCode
          .replace('__PHYSICS_WASM_DATA_URL__', physicsWasmDataUrl || 'null')
          .replace('__HAS_CACHED_WASM__', hasCachedWasm.toString());

        const modifiedCode = workerHooksWithWasm + workerCode;

        const blob = new Blob([modifiedCode], { type: 'application/javascript' });
        const newURL = URL.createObjectURL(blob);
        console.log('=== PRELOAD: Worker modified ===');
        const worker = new originalWorker(newURL, options);

        // Listen for WASM save requests and pass to Node.js
        worker.addEventListener('message', function(event) {
          if (event.data && event.data.type === '__TS_PML_SAVE_WASM__') {
            const bufferLength = event.data.wasmBuffer.length;
            const memorySize = event.data.memorySize || (bufferLength / 1024 / 1024);
            const source = event.data.source || 'unknown';

            console.log('=== PRELOAD: Saving WASM to disk ===', bufferLength, 'bytes (' + memorySize.toFixed(2) + ' MB) from', source);

            try {
              // Ensure lib directory exists
              const libDir = path.join(__dirname, 'lib');
              if (!fs.existsSync(libDir)) {
                fs.mkdirSync(libDir);
              }

              // Save with descriptive filename based on size
              const sizeMB = Math.round(memorySize);
              const filename = `polytrack_physics_${sizeMB}MB.wasm`;
              const savePath = path.join(libDir, filename);

              fs.writeFileSync(savePath, Buffer.from(event.data.wasmBuffer));
              console.log('%c✅✅✅ PRELOAD: WASM SAVED AS ' + filename + '! ✅✅✅', 'color: #0f0; font-size: 16px');

              // If this is larger than 10MB, update the main physics WASM path
              if (memorySize > 10) {
                fs.writeFileSync(physicsWasmPath, Buffer.from(event.data.wasmBuffer));
                console.log('%c✅✅✅ PRELOAD: This is the PHYSICS WASM! Updated main file. ✅✅✅', 'color: #0f0; font-size: 16px');
              }
            } catch (err) {
              console.error('=== PRELOAD: Failed to save WASM ===', err);
            }
          }
          if (event.data && event.data.type === '__TS_PML_WASM_READY__') {
            console.log('%c✅✅✅ PRELOAD: PHYSICS WASM READY! ✅✅✅', 'color: #0f0; font-size: 20px');
            window.__TS_PML_WORKER_WASM_READY__ = true;
            console.log('   Exports:', event.data.wasm.exports);
            console.log('   Memory:', event.data.wasm.memorySize.toFixed(2), 'MB');

            // Forward to window so main thread code can receive it
            window.postMessage(event.data, '*');
          }
        });

        return worker;
      }
    } catch (err) {
      console.error('=== PRELOAD: Error ===', err);
    }
  }

  return new originalWorker(scriptURL, options);
};

// Listen for worker messages
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === '__TS_PML_WASM_READY__') {
    console.log('%c✅✅✅ PRELOAD MESSAGE: PHYSICS WASM READY! ✅✅✅', 'color: #0f0; font-size: 20px');
  }
  if (event.data && event.data.type === '__TS_PML_CAR_STATE_BUFFER_READY__') {
    console.log('%c🎯✅✅✅ PRELOAD: CAR STATE BUFFER READY! 0x' + event.data.bufferAddress.toString(16) + ' ✅✅✅', 'color: #0f0; font-size: 16px');
    window.__TS_PML_CAR_STATE_BUFFER__ = event.data.bufferAddress;
  }
  if (event.data && event.data.type === '__TS_PML_CAR_STATE_READY__') {
    console.log('%c🎯✅✅✅ PRELOAD: CAR STATE READY! ✅✅✅', 'color: #0f0; font-size: 16px');
    console.log('   Car state hex (first 227 bytes):', event.data.carState.substring(0, 200) + '...');
    window.__TS_PML_CAR_STATE__ = event.data.carState;
    window.__TS_PML_CAR_STATE_BUFFER__ = event.data.carStateBuffer;
  }
  if (event.data && event.data.type === '__TS_PML_CAR_STATE_BUFFER__') {
    console.log('📨 PRELOAD: Car state buffer response, address: 0x' + event.data.bufferAddress?.toString(16));
    window.__TS_PML_CAR_STATE_BUFFER__ = event.data.bufferAddress;
  }
  if (event.data && event.data.type === '__TS_PML_CAR_STATE_RESPONSE__') {
    console.log('📨 PRELOAD: Car state response:', event.data.success ? 'success' : event.data.error || 'data received');
  }
});

console.log('=== PRELOAD SCRIPT READY ===');

// Store reference to simulation worker for main thread access
window.__TS_PML_SIMULATION_WORKER__ = null;

// Override Worker to capture simulation worker reference
const _originalWorkerConstructor = window.Worker;
window.Worker = function(scriptURL, options) {
  const worker = new _originalWorkerConstructor(scriptURL, options);

  // Check if this might be a simulation worker (by URL or by detecting WASM ready messages)
  if (typeof scriptURL === 'string' && scriptURL.includes('simulation_worker')) {
    window.__TS_PML_SIMULATION_WORKER__ = worker;
    console.log('=== PRELOAD: Captured simulation worker reference (URL match) ===');

    // 🔍 INTERCEPT MESSAGES SENT TO WORKER (to find control inputs + INJECT CONTROLS)
    var workerPostMessage = worker.postMessage.bind(worker);
    worker.postMessage = function(message, transfer) {
      if (message && typeof message === 'object') {
        // 🎮 CONTROL INJECTION: Apply control overrides before sending to worker
        if (message.messageType === 6) {
          var controlsBridge = (window.__TS_PML_CONTROLS__ && window.__TS_PML_CONTROLS__.getOverrides && window.__TS_PML_CONTROLS__.getOverrides());
          if (controlsBridge) {
            // Apply overrides - these replace the player's actual input
            if (controlsBridge.up !== undefined) message.up = controlsBridge.up;
            if (controlsBridge.right !== undefined) message.right = controlsBridge.right;
            if (controlsBridge.down !== undefined) message.down = controlsBridge.down;
            if (controlsBridge.left !== undefined) message.left = controlsBridge.left;
            if (controlsBridge.reset !== undefined) message.reset = controlsBridge.reset;
            console.log('🎮 [TS-PML] CONTROL OVERRIDES APPLIED: up=' + message.up + ' right=' + message.right + ' down=' + message.down + ' left=' + message.left + ' reset=' + message.reset);
          }
        }

        var keys = Object.keys(message);
        var parts = [];

        for (var i = 0; i < keys.length; i++) {
          var val = message[keys[i]];
          if (typeof val === 'number') {
            parts.push(keys[i] + '=' + val.toFixed(2));
          } else if (typeof val === 'boolean') {
            parts.push(keys[i] + '=' + (val ? 'T' : 'F'));
          } else if (val === undefined) {
            parts.push(keys[i] + '=undef');
          } else if (val === null) {
            parts.push(keys[i] + '=null');
          } else if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'number') {
            parts.push(keys[i] + '=[' + val.slice(0, 4).map(function(n) { return n.toFixed(1); }).join(',') + ']');
          } else if (typeof val === 'object') {
            parts.push(keys[i] + '={...}');
          } else {
            parts.push(keys[i] + '=' + typeof val);
          }
        }

        // Always log control messages (messageType 6) and interesting ones (DISABLED to reduce spam)
        // Only log when overrides are applied (see below)
        // if (message.messageType === 6 || message.messageType === 0 || message.messageType === 3 || message.messageType === 4 || message.messageType === 5) {
        //   console.log('📤 [' + message.messageType + '] ' + parts.join(', '));
        // }
      }

      return workerPostMessage(message, transfer);
    };
    console.log('=== PRELOAD: Worker postMessage hook installed (with control injection) ===');
  }

  // 📝 CAR STATE WRITE SYSTEM: Intercept messages and apply pending writes
  window.__TS_PML_PENDING_WRITES__ = {
    position: null,  // { x, y, z } or null
    speed: null,     // number or null
    rotation: null,  // { x, y, z, w } or null
    oneShot: true    // If true, clear after applying (teleport behavior)
  };

  // Intercept addEventListener to track the game's message listeners
  var originalAddEventListener = worker.addEventListener.bind(worker);
  var gameMessageListeners = [];

  worker.addEventListener = function(type, listener, options) {
    if (type === 'message') {
      // Store the game's listener so we can call it with modified data
      gameMessageListeners.push(listener);
      // Don't add it yet - we'll call it manually
      return;
    }
    return originalAddEventListener(type, listener, options);
  };

  // Now add OUR listener first - it will intercept all messages and call game listeners with modified data
  originalAddEventListener.call(worker, 'message', function(event) {
    // Stop the original event from reaching the game's listeners directly
    // We'll call them manually with our modified data instead
    event.stopImmediatePropagation();

    var modifiedData = event.data;

    // Check if this is an UpdateResult message (messageType 10)
    if (event.data && event.data.messageType === 10 && event.data.carStateBuffers) {
      // Find the player's car using position tracking (same algorithm as worker)
      var buffers = event.data.carStateBuffers;
      var playerIndex = -1;

      // Simple heuristic: find car with reasonable position.z (altitude 0-500)
      for (var i = 0; i < buffers.length; i++) {
        if (buffers[i] instanceof ArrayBuffer && buffers[i].byteLength >= 64) {
          var view = new DataView(buffers[i]);
          var posZ = view.getFloat32(43, true);  // position.z offset
          if (posZ >= -100 && posZ <= 500) {
            playerIndex = i;
            break;
          }
        }
      }

      if (playerIndex >= 0 && window.__TS_PML_PENDING_WRITES__) {
        var writes = window.__TS_PML_PENDING_WRITES__;
        var playerBuffer = buffers[playerIndex];
        var playerView = new DataView(playerBuffer);
        var modified = false;

        // Apply position writes
        if (writes.position) {
          playerView.setFloat32(35, writes.position.x, true);  // position.x
          playerView.setFloat32(39, writes.position.y, true);  // position.y
          playerView.setFloat32(43, writes.position.z, true);  // position.z
          console.log('📝 [TS-PML] POSITION WRITE APPLIED:', writes.position);
          modified = true;
        }

        // Apply speed write
        if (writes.speed !== null) {
          playerView.setFloat32(4, writes.speed, true);  // speedKmh
          console.log('📝 [TS-PML] SPEED WRITE APPLIED:', writes.speed);
          modified = true;
        }

        // Apply rotation write
        if (writes.rotation) {
          playerView.setFloat32(47, writes.rotation.x, true);  // quaternion.x (may not be actual quat)
          playerView.setFloat32(51, writes.rotation.y, true);  // quaternion.y (heading)
          playerView.setFloat32(55, writes.rotation.z, true);  // quaternion.z
          playerView.setFloat32(59, writes.rotation.w, true);  // quaternion.w
          console.log('📝 [TS-PML] ROTATION WRITE APPLIED:', writes.rotation);
          modified = true;
        }

        // Create modified message with updated buffer
        if (modified) {
          modifiedData = Object.assign({}, event.data);
          var newBuffers = buffers.slice();
          newBuffers[playerIndex] = playerBuffer;  // Buffer is modified in-place
          modifiedData.carStateBuffers = newBuffers;
        }

        // Clear one-shot writes after applying
        if (writes.oneShot) {
          window.__TS_PML_PENDING_WRITES__.position = null;
          window.__TS_PML_PENDING_WRITES__.speed = null;
          window.__TS_PML_PENDING_WRITES__.rotation = null;
        }
      }
    }

    // Forward __TS_PML_ messages via window.postMessage
    if (modifiedData && modifiedData.type && modifiedData.type.startsWith('__TS_PML_')) {
      window.postMessage(modifiedData, '*');
    }

    // Identify physics worker
    if (modifiedData && modifiedData.type === '__TS_PML_WASM_READY__') {
      window.__TS_PML_SIMULATION_WORKER__ = worker;
      window.__TS_PML_PHYSICS_WASM_READY__ = true;
      console.log('=== PRELOAD: Physics worker identified via WASM ready message ===');
    }

    // Call the game's message listeners with our modified data
    for (var i = 0; i < gameMessageListeners.length; i++) {
      try {
        // Create a synthetic event with modified data
        var syntheticEvent = { data: modifiedData };
        gameMessageListeners[i](syntheticEvent);
      } catch (e) {
        console.error('[TS-PML] Error in game message listener:', e);
      }
    }
  }, false);

  return worker;
};

/**
 * Strategy: Intercept WASM loading and modify it
 *
 * This hooks into the game's WASM loading process and:
 * 1. Modifies the WASM binary before it's instantiated
 * 2. Injects our own exported functions
 * 3. Adds memory hooks for clean API
 */

const WASMInterceptMod = {
  modName: 'WASM Interceptor',
  modID: 'wasm-intercept',
  modVersion: '1.0.0',

  init: (pml) => {
    console.log('🔧 Setting up WASM interception...');

    // Hook fetch to intercept WASM loading
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];

      // Check if loading WASM file
      if (typeof url === 'string' && url.includes('polytrack_physics.wasm')) {
        console.log('🎯 Intercepting WASM load:', url);

        return originalFetch.apply(this, args)
          .then(response => {
            // Clone the response so we can modify it
            return response.arrayBuffer().then(buffer => {
              console.log('📦 WASM binary loaded:', buffer.byteLength, 'bytes');

              // Here we can modify the WASM binary!
              // For now, just pass it through
              return new Response(buffer, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
              });
            });
          });
      }

      // Normal fetch - pass through
      return originalFetch.apply(this, args);
    };

    // Hook WebAssembly.instantiate to modify the instance
    const originalInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = function(...args) {
      console.log('🏭 WebAssembly.instantiate called');

      // Check if this is the physics WASM
      const moduleOrArgs = args[0];

      return originalInstantiate.apply(this, args).then(result => {
        const instance = result.instance || result;
        const module = result.module || args[0];

        console.log('✅ WASM instantiated!');
        console.log('   Exports:', Object.keys(instance.exports));

        // If memory is exported, expose it globally
        if (instance.exports.memory) {
          console.log('✅ Memory export found! Exposing globally...');
          window.__TS_PML_WASM_MEMORY__ = instance.exports.memory;
          window.__TS_PML_WASM_INSTANCE__ = instance;

          // Create clean API that uses WASM memory
          pml.wasmMemory = instance.exports.memory;
          pml.player = {
            getSpeed: () => {
              // TODO: Find actual offset
              const view = new DataView(instance.exports.memory.buffer);
              return view.getFloat32(0, true);  // Placeholder
            },
            setSpeed: (speed) => {
              const view = new DataView(instance.exports.memory.buffer);
              view.setFloat32(0, speed, true);  // Placeholder
            }
          };

          console.log('✅ Clean API created with WASM memory access!');
        }

        return result;
      });
    };

    console.log('✅ WASM interception hooks installed!');
  }
};

window.polyMod = WASMInterceptMod;

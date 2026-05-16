/**
 * WASM Memory Access - Direct Physics Manipulation
 * Access car state through WebAssembly memory
 */

// In your mod's init(), add this:

const WASMAccessMod = {
  modName: 'WASM Memory Access',
  modID: 'wasm-memory',
  modVersion: '1.0.0',

  init: (pml) => {
    console.log('🔧 Setting up WASM memory access...');

    // Find the WASM instance that's loaded by the game
    const findWasmInstance = () => {
      // Method 1: Check if WebAssembly module is accessible
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        if (script.src.includes('polytrack_physics')) {
          console.log('[WASM] Found physics script tag');
        }
      }

      // Method 2: Access WebAssembly instances in page
      for (const key in window) {
        try {
          const val = window[key];
          if (val && val instanceof WebAssembly.Module) {
            console.log(`[WASM] Found WASM module at window.${key}`);
          }
          if (val && val instanceof WebAssembly.Instance) {
            console.log(`[WASM] Found WASM instance at window.${key}`);
            console.log(`[WASM] Exports:`, Object.keys(val.exports));

            // Check for memory export
            if (val.exports.memory) {
              console.log(`[WASM] ✓ Memory export found!`);
              const memory = val.exports.memory;
              const buffer = new Uint8Array(memory.buffer);

              // Show some memory content
              console.log(`[WASM] Memory size: ${memory.buffer.byteLength} bytes`);
              console.log(`[WASM] First 100 bytes:`, buffer.slice(0, 100));

              // Try to find patterns that might be car state
              console.log(`[WASM] Searching for float patterns (might be position/speed)...`);

              // Look for float32 values (physics uses floats)
              const view = new DataView(memory.buffer);
              const floats = [];

              for (let i = 0; i < Math.min(10000, memory.buffer.byteLength / 4); i++) {
                const value = view.getFloat32(i * 4, true);
                // Look for reasonable physics values
                if (value > -1000 && value < 1000 && value !== 0) {
                  floats.push({ offset: i * 4, value: value });
                }
              }

              console.log(`[WASM] Found ${floats.length} potential float values`);
              console.log(`[WASM] First 20:`, floats.slice(0, 20));

              return val;
            }
          }
        } catch (e) {}
      }

      console.log('[WASM] No WASM instance found yet (may need to be in race)');
      return null;
    };

    // Try to find WASM
    const wasmInstance = findWasmInstance();

    if (wasmInstance) {
      console.log('✅ [WASM] Successfully accessed WASM instance!');

      // Store for later use
      window.__TS_PML_WASM__ = wasmInstance;

      // Create API to access WASM memory
      pml.wasm = {
        instance: wasmInstance,
        memory: wasmInstance.exports.memory,
        readFloat: (offset) => {
          const view = new DataView(wasmInstance.exports.memory.buffer);
          return view.getFloat32(offset, true);
        },
        writeFloat: (offset, value) => {
          const view = new DataView(wasmInstance.exports.memory.buffer);
          view.setFloat32(offset, value, true);
        },
        readInt: (offset) => {
          const view = new DataView(wasmInstance.exports.memory.buffer);
          return view.getInt32(offset, true);
        },
        writeInt: (offset, value) => {
          const view = new DataView(wasmInstance.exports.memory.buffer);
          view.setInt32(offset, value, true);
        }
      };

      console.log('✅ [WASM] Memory API created!');
    } else {
      console.log('⚠️ [WASM] WASM not found - try starting a race first');
    }
  }
};

window.polyMod = WASMAccessMod;

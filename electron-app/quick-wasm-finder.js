/**
 * QUICK WASM FINDER - Paste this in DevTools console while driving!
 */

console.log('🔍 Searching for WASM physics...');

let foundWasm = false;

// Search for WebAssembly.Instance
for (const key in window) {
    try {
        const val = window[key];
        if (val && val instanceof WebAssembly.Instance) {
            console.log('✅ Found WASM instance at window.' + key);
            console.log('   Exports:', Object.keys(val.exports));

            if (val.exports.memory) {
                const memory = val.exports.memory;
                console.log('   ✓ Memory export found!');
                console.log('   Memory size:', (memory.buffer.byteLength / 1024 / 1024).toFixed(2), 'MB');

                // Show some memory content
                const view = new DataView(memory.buffer);
                console.log('   First 10 float32 values:');
                for (let i = 0; i < 10; i++) {
                    const value = view.getFloat32(i * 4, true);
                    console.log('     Offset', i * 4, '=', value);
                }

                // Search for interesting float patterns
                console.log('   Searching for speed-like values (0-200)...');
                let speedCount = 0;
                for (let i = 0; i < Math.min(10000, memory.buffer.byteLength / 4); i++) {
                    const value = view.getFloat32(i * 4, true);
                    if (value > 0 && value < 200 && value !== 0) {
                        speedCount++;
                        if (speedCount <= 10) {
                            console.log('     Offset', i * 4, '=', value, '(might be speed)');
                        }
                    }
                }
                console.log('   Found ' + speedCount + ' potential speed values');

                foundWasm = true;
            }
        }
        if (val && val instanceof WebAssembly.Module) {
            console.log('✅ Found WASM module at window.' + key);
        }
    } catch (e) {}
}

if (!foundWasm) {
    console.log('❌ No WASM found - make sure you\'re IN A RACE (driving the car)');
    console.log('   The physics WASM might only load when you\'re actually playing.');
} else {
    console.log('🎉 SUCCESS! WASM physics is accessible!');
    console.log('   This means we CAN create a clean API by reading/writing WASM memory!');
}

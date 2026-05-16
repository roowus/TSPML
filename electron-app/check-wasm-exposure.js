/**
 * Paste this in DevTools console to check if WASM is exposed
 * Run this after the game has loaded
 */

console.log('🔍 Checking for TS PML WASM exposure...');

if (window.__TS_PML_WASM__) {
    console.log('✅ SUCCESS! WASM is exposed!');
    console.log('   Instance:', window.__TS_PML_WASM__.instance);
    console.log('   Exports:', Object.keys(window.__TS_PML_WASM__.exports));
    console.log('   Memory:', window.__TS_PML_WASM__.memory);
    console.log('   Memory size:', (window.__TS_PML_WASM__.memory.buffer.byteLength / 1024 / 1024).toFixed(2), 'MB');

    // Test reading memory
    const view = new DataView(window.__TS_PML_WASM__.memory.buffer);
    console.log('   First 10 float32 values:');
    for (let i = 0; i < 10; i++) {
        const value = view.getFloat32(i * 4, true);
        console.log(`     Offset ${i * 4} = ${value}`);
    }

    console.log('🎉 WASM is accessible for TS PML clean API!');
} else {
    console.log('❌ WASM not exposed yet.');
    console.log('   Make sure:');
    console.log('   1. You are using the modified main.bundle.js');
    console.log('   2. The game has fully loaded');
    console.log('   3. Wait a moment for WASM to initialize');
}

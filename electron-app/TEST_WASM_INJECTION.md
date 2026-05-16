# Testing WASM Injection

## Changes Made

Modified `main.js` to intercept network requests and serve our modified `main.bundle.js` with WASM injection code.

## How to Test

1. **Start the Electron app**:
   ```bash
   cd /Users/rewis/polytrack-dev/ts-pml/electron-app
   npm start
   ```

2. **Look in the terminal** for these messages:
   - `✅ Modified main.bundle.js loaded: 3048762 bytes`
   - `🔄 Serving modified main.bundle.js` (when game loads)
   - `✅ TS PML: WASM physics exposed!` (in browser console)

3. **Check browser DevTools console** for:
   ```
   ✅ TS PML: WASM physics exposed!
      Memory size: 16.00 MB
      Available exports: [...]
   ```

4. **Test WASM access** by running in console:
   ```javascript
   console.log(window.__TS_PML_WASM__)
   ```
   Should show the instance, exports, and memory objects.

## How It Works

1. **Custom Protocol**: We register `polytrack://` protocol
2. **Request Interception**: Redirect `main.bundle.js` requests to our protocol
3. **Serve Modified File**: Our version with WASM injection is served
4. **WASM Exposed**: When game loads WASM, it's exposed globally

## What Should Happen

When you start the app and the game loads:

1. Network requests for `main.bundle.js` are intercepted
2. Our modified version is served instead
3. Game loads with our injection code
4. WASM is exposed via `window.__TS_PML_WASM__`
5. You can then run `memory-scanner.js` to find car offsets

## Troubleshooting

**If WASM is not exposed:**

1. Check terminal for `🔄 Serving modified main.bundle.js`
2. Check browser console for any errors
3. Verify `deobfuscated-main.bundle.js` exists and has injection code
4. Try clearing cache and restarting

**If game doesn't load:**

1. Check terminal for error messages
2. Check if other resources are being fetched correctly
3. Look at the Network tab in DevTools

## Next Steps After Success

Once WASM is exposed:

1. Run `memory-scanner.js` in console
2. Drive around for 10-20 seconds
3. Run `wasmScanner.stop()` to see analysis
4. Test candidate offsets with `wasmScanner.testOffset(0x...)`
5. Document the memory offsets for car state
6. Create clean API using those offsets

/**
 * Run this in DevTools Console to find the car!
 *
 * This will search through the game's internal structures
 * to find where the car object is actually stored.
 */

console.log('🔍 Starting deep car search...');

// Helper: Check if object has car methods
function isCar(obj, path) {
    if (!obj || typeof obj !== 'object') return false;

    const hasGetSpeed = typeof obj.getSpeedKmh === 'function';
    const hasSetState = typeof obj.setCarState === 'function';
    const hasGetPosition = typeof obj.getPosition === 'function';
    const hasSetPosition = typeof obj.setPosition === 'function';

    if (hasGetSpeed || hasSetState || hasGetPosition || hasSetPosition) {
        console.log(`✅ Found car at: ${path}`);
        console.log(`  Methods: ${Object.getOwnPropertyNames(Object.getPrototypeOf(obj)).filter(n => n.startsWith('get') || n.startsWith('set')).join(', ')}`);
        return true;
    }
    return false;
}

// Search 1: Try accessing webpack modules
console.log('\n--- Searching Webpack Modules ---');
try {
    if (typeof __webpack_require__ !== 'undefined') {
        console.log('✅ Found __webpack_require__');

        // Try to access module cache
        const cache = __webpack_require__.c || __webpack_require__.cache;
        if (cache) {
            console.log(`✅ Found webpack cache with ${Object.keys(cache).length} modules`);

            // Search through modules
            let foundCount = 0;
            for (const [id, module] of Object.entries(cache)) {
                try {
                    if (module && module.exports) {
                        const exports = module.exports;

                        // Check if exports has car
                        if (isCar(exports, `webpack_module_${id}`)) {
                            foundCount++;
                            console.log(`  Module ${id}:`, exports);
                        }

                        // Check properties of exports
                        if (typeof exports === 'object') {
                            for (const [key, val] of Object.entries(exports)) {
                                if (isCar(val, `webpack_module_${id}.${key}`)) {
                                    foundCount++;
                                    console.log(`  Found car in module ${id}, property "${key}"`);
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            if (foundCount === 0) {
                console.log('❌ No car found in webpack modules');
            }
        }
    } else {
        console.log('❌ __webpack_require__ not found');
    }
} catch (e) {
    console.log('❌ Error accessing webpack:', e.message);
}

// Search 2: Look for common game object patterns
console.log('\n--- Searching Common Patterns ---');
const patterns = [
    'game',
    'Game',
    'app',
    'App',
    'world',
    'World',
    'scene',
    'Scene',
    'state',
    'State',
    'player',
    'Player',
    'car',
    'Car',
    'cars',
    'Cars',
    'visual',
    'Visual',
    'entity',
    'Entity',
    'object',
    'Object',
    'instance',
    'Instance'
];

for (const pattern of patterns) {
    try {
        const val = window[pattern];
        if (val && typeof val === 'object') {
            console.log(`Checking window.${pattern}...`);

            if (isCar(val, `window.${pattern}`)) {
                console.log(`  ✅ window.${pattern} IS the car!`);
            }

            // Check properties
            let propCount = 0;
            for (const [key, val2] of Object.entries(val)) {
                if (isCar(val2, `window.${pattern}.${key}`)) {
                    propCount++;
                }
            }

            if (propCount > 0) {
                console.log(`  Found ${propCount} car-like objects in window.${pattern}`);
            }
        }
    } catch (e) {}
}

// Search 3: Look for arrays that might contain cars
console.log('\n--- Searching for Car Arrays ---');
for (const key in window) {
    try {
        const val = window[key];
        if (Array.isArray(val) && val.length > 0 && val.length < 100) {
            // Check if array contains car-like objects
            for (let i = 0; i < val.length; i++) {
                if (val[i] && typeof val[i] === 'object') {
                    if (isCar(val[i], `window.${key}[${i}]`)) {
                        console.log(`  ✅ Found car in array window.${key}[${i}]`);
                    }
                }
            }
        }
    } catch (e) {}
}

// Search 4: Look for objects with 'car' in the property name
console.log('\n--- Searching for Properties with "car" in name ---');
for (const key in window) {
    if (key.toLowerCase().includes('car')) {
        try {
            const val = window[key];
            console.log(`Checking window.${key}...`);

            if (isCar(val, `window.${key}`)) {
                console.log(`  ✅ This IS a car!`);
            }

            // If it's an object, check its properties
            if (val && typeof val === 'object') {
                for (const [k, v] of Object.entries(val)) {
                    if (isCar(v, `window.${key}.${k}`)) {
                        console.log(`  ✅ Found car at window.${key}.${k}`);
                    }
                }
            }
        } catch (e) {}
    }
}

// Search 5: Try to find THREE.js objects (cars might be in the scene)
console.log('\n--- Searching THREE.js Scene ---');
try {
    if (typeof THREE !== 'undefined') {
        console.log('✅ THREE.js is loaded');

        // Look for scene
        const canvases = document.querySelectorAll('canvas');
        console.log(`Found ${canvases.length} canvas(es)`);

        // Try to find objects in the scene
        for (const key in window) {
            try {
                const val = window[key];
                if (val && val instanceof THREE.Object3D) {
                    console.log(`Found THREE.Object3D at window.${key}`);
                    isCar(val, `window.${key}`);
                }
            } catch (e) {}
        }
    }
} catch (e) {
    console.log('❌ THREE.js not accessible');
}

console.log('\n--- Summary ---');
console.log('If you see "✅ Found car" above, copy that path!');
console.log('Then you can access it with: window.<path from above>');
console.log('\nExample: If it says "Found car at window.game.cars[0]"');
console.log('Then use: window.game.cars[0].getSpeedKmh()');

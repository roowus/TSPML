/**
 * Debug script to find actual code patterns in PolyTrack
 * Run this in DevTools console to find the right mixin search strings
 */

console.log('🔍 Searching for car state patterns...');

// Search for setCarState calls
const findSetCarState = () => {
  // Get all scripts
  const scripts = Array.from(document.querySelectorAll('script'));
  const mainScript = scripts.find(s => s.src.includes('main.bundle'));

  if (mainScript) {
    console.log('✅ Found main.bundle.js');
    // We can't read the source directly due to CORS, but we can search the global scope
  }

  // Search for VisualCar in global scope
  console.log('Searching for VisualCar...');

  // Check if any WeakMaps exist in window
  const weakMapKeys = Object.keys(window).filter(key => {
    try {
      return window[key] instanceof WeakMap;
    } catch(e) {
      return false;
    }
  });

  console.log(`Found ${weakMapKeys.length} WeakMaps in window scope:`, weakMapKeys);

  // Search for common patterns
  const patterns = [
    'setCarState',
    'carState',
    'speedKmh',
    'VisualCar',
    'createCar',
    'getPosition',
    'getSpeedKmh'
  ];

  patterns.forEach(pattern => {
    const exists = Object.values(window).some(val => {
      if (typeof val === 'function') {
        return val.toString().includes(pattern);
      }
      if (typeof val === 'object' && val !== null) {
        try {
          return JSON.stringify(val).includes(pattern);
        } catch(e) {
          return false;
        }
      }
      return false;
    });

    console.log(`"${pattern}": ${exists ? '✅ Found' : '❌ Not found'}`);
  });

  // Try to find the car state by searching eval
  console.log('\n🔍 Attempting to find car state through eval...');

  try {
    // Search for common webpack module patterns
    const modules = typeof __webpack_require__ !== 'undefined' ? __webpack_require__ : null;
    if (modules) {
      console.log('✅ Webpack modules found');
      console.log('Module cache:', Object.keys.modules.c || {});
    }
  } catch(e) {
    console.log('❌ Cannot access webpack modules');
  }

  // Check for any car-related objects
  console.log('\n🔍 Searching for car-related objects...');
  const carKeys = Object.keys(window).filter(key =>
    key.toLowerCase().includes('car') ||
    key.toLowerCase().includes('player') ||
    key.toLowerCase().includes('visual')
  );

  console.log('Car/Player related keys:', carKeys);

  return {
    weakMapKeys,
    carKeys,
    patternsFound: patterns
  };
};

// Run the search
const results = findSetCarState();
console.log('📊 Search results:', results);

// Export for easy access
window.__TS_PML_DEBUG__ = {
  findSetCarState,
  results
};

console.log('✅ Debug complete. Access results via window.__TS_PML_DEBUG__');

// Load TS PML immediately when preload script runs
const fs = require('fs');
const path = require('path');

console.log('🔌 [Preload] Preload script executing...');

// Read and inject TS PML loader BEFORE page content loads
const loaderCode = fs.readFileSync(path.join(__dirname, 'TS_PML_LOADER.js'), 'utf8');

// Method 1: Inject immediately via script tag
const script = document.createElement('script');
script.textContent = loaderCode;
script.async = false;  // Execute immediately
(document.documentElement || document.head).appendChild(script);

console.log('✅ [Preload] TS PML injected before page load!');

// Method 2: Also inject when DOM is ready as backup
window.addEventListener('DOMContentLoaded', () => {
  console.log('🔌 [Preload] DOM ready, TS PML should already be loaded...');

  // Verify TS PML is available
  setTimeout(() => {
    if (window.ActivePolyModLoader) {
      console.log('✅ [Preload] ActivePolyModLoader is available!');
    } else {
      console.error('❌ [Preload] ActivePolyModLoader NOT found!');
    }
  }, 100);
});

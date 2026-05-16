/**
 * Clean API Test Mod
 * Demonstrates the simple API: player.setSpeed(50) instead of mixins
 */

const cleanAPITestMod = {
  modName: 'Clean API Test',
  modID: 'clean-api-test',
  modVersion: '1.0.0',
  modAuthor: 'TS PML',

  init: (pml) => {
    console.log('🚀 [Clean API Test] init called!');
    console.log('🚀 [Clean API Test] pml.player exists:', !!pml.player);
    console.log('🚀 [Clean API Test] window.__TS_PML_CAR_STATE__ exists:', !!window.__TS_PML_CAR_STATE__);

    // Test 1: Check if clean API is available
    if (pml.player) {
      console.log('✅ [Clean API Test] Player API is available!');

      // Test 2: Register keybind to test speed manipulation
      pml.registerKeybind(
        'Super Speed',
        'superSpeed',
        'keydown',
        'KeyU',
        null,
        () => {
          console.log('🔑 [Clean API Test] U key pressed!');
          console.log('🔍 [Clean API Test] window.__TS_PML_CAR_STATE__:', window.__TS_PML_CAR_STATE__);
          console.log('🔍 [Clean API Test] window.__TS_PML_VISUAL_CAR__:', window.__TS_PML_VISUAL_CAR__);

          // Get current speed
          const speed = pml.player.getSpeed();
          console.log(`📊 [Clean API Test] Current speed: ${speed} km/h`);

          // Increase speed
          const newSpeed = speed + 50;
          const success = pml.player.setSpeed(newSpeed);
          console.log(`🚀 [Clean API Test] Speed increase ${success ? 'succeeded' : 'failed'}!`);

          // Check if it actually changed
          setTimeout(() => {
            const actualSpeed = pml.player.getSpeed();
            console.log(`📊 [Clean API Test] Speed after change: ${actualSpeed} km/h`);
            alert(`Clean API Test!\nOld speed: ${speed} km/h\nNew speed: ${actualSpeed} km/h\n${success ? 'Success!' : 'Failed - car may not be detected yet'}`);
          }, 100);
        }
      );

      console.log('✅ [Clean API Test] Press U to test speed increase!');
      console.log('ℹ️  [Clean API Test] Race detection active - will find car when you start playing!');

      // Test 3: Poll for car state availability (continuous, no timeout)
      let checkCount = 0;
      const checkInterval = setInterval(() => {
        checkCount++;
        if (window.__TS_PML_CAR_STATE__) {
          clearInterval(checkInterval);
          const speed = pml.player.getSpeed();
          const pos = pml.player.getPosition();
          console.log(`✅ [Clean API Test] Car state detected after ${checkCount} checks!`);
          console.log(`📊 [Clean API Test] Speed: ${speed} km/h, Position: (${pos.x}, ${pos.y}, ${pos.z})`);
        } else if (checkCount % 30 === 0) {
          // Reminder every 30 seconds
          console.log('ℹ️  [Clean API Test] Still waiting for car... The race detection will find it when you start playing!');
        }
      }, 1000);

    } else {
      console.error('❌ [Clean API Test] Player API not available!');
    }
  }
};

// Export for TS PML
window.polyMod = cleanAPITestMod;
console.log('✅ Clean API test mod loaded and polyMod set!');

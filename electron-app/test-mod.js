/**
 * Simple test mod to verify TS PML works
 */
class SpeedMod {
  modName = 'Speed Test Mod';
  modID = 'speed-test';
  modVersion = '1.0.0';
  modAuthor = 'TS PML';

  preInit = (pml) => {
    console.log('🚀 [SpeedMod] preInit called!');
    console.log('🚀 [SpeedMod] PML object:', pml);
  }

  init = (pml) => {
    console.log('🚀 [SpeedMod] init called!');
    console.log('🚀 [SpeedMod] PML has registerKeybind:', typeof pml.registerKeybind);
    console.log('🚀 [SpeedMod] TS PML is working!');

    try {
      // Register a keybind to test speed manipulation
      pml.registerKeybind(
        'Super Speed',
        'superSpeed',
        'keydown',
        'KeyY',
        null,
        () => {
          console.log('🚀🚀🚀 [SpeedMod] Super speed activated!');
          alert('Speed Mod activated! Y key works!');
        }
      );
      console.log('✅ [SpeedMod] Keybind registered successfully!');
    } catch (err) {
      console.error('❌ [SpeedMod] Failed to register keybind:', err);
    }
  }

  postInit = () => {
    console.log('🚀 [SpeedMod] postInit called!');
    console.log('🚀 [SpeedMod] Mod fully loaded! Press Y to test!');
  }
}

// Export mod instance for TS PML
const polyMod = new SpeedMod();
console.log('✅ [SpeedMod] Mod instance created:', polyMod);
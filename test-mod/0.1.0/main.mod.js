/**
 * TS PML Test Mod
 * Simple test to verify TS PML is working
 */

class TSPMLTestMod {
  modName = 'TS PML Test';
  modID = 'tspml-test';
  modVersion = '0.1.0';
  modAuthor = 'TS PML Team';

  preInit = (pml) => {
    console.log('[TS PML Test] preInit called!');
    console.log('[TS PML Test] PML version:', pml.polyVersion);

    // Test that we can access game code
    try {
      const test = pml.getFromPolyTrack('window');
      console.log('[TS PML Test] Can access window:', !!test);
    } catch (e) {
      console.log('[TS PML Test] getFromPolyTrack test:', e.message);
    }
  }

  init = (pml) => {
    console.log('[TS PML Test] init called!');

    // Register a setting
    pml.registerSetting('Test Mode', 'testMode', 3, true);

    // Register a keybind
    pml.registerKeybind(
      'Test Action',
      'testAction',
      'keydown',
      'KeyT',
      null,
      () => {
        console.log('[TS PML Test] Keybind pressed!');
        alert('TS PML is working! 🎉');
      }
    );

    console.log('[TS PML Test] Press T to test!');
  }

  postInit = () => {
    console.log('[TS PML Test] postInit called!');
    console.log('[TS PML Test] All lifecycle hooks work! ✅');
  }
}

// Export mod instance
export let polyMod = new TSPMLTestMod();

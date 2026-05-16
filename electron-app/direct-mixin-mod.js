/**
 * Direct Mixin Mod - No clean API, just raw mixin power
 * This mod modifies the game code directly to add features
 */

const directMixinMod = {
  modName: 'Direct Mixin Example',
  modID: 'direct-mixin-test',
  modVersion: '1.0.0',
  modAuthor: 'TS PML',

  init: (pml) => {
    console.log('🔧 Registering direct mixins...');

    // Mixin 1: Modify car speed directly in the code
    pml.registerGlobalMixin({
      type: 'REPLACE',
      search: 'speedKmh: 0,',
      replace: 'speedKmh: 999999,  // TS PML: Super speed!',
    });

    // Mixin 2: Log when car state is created
    pml.registerGlobalMixin({
      type: 'INSERT',
      search: 'carState: {',
      replace: `carState: {
        console.log('[TS PML] Car state created!', this);
      `
    });

    console.log('✅ Mixins registered! They will modify the game code directly.');
    console.log('ℹ️  Note: This modifies the actual game code, not a clean API');
  }
};

window.polyMod = directMixinMod;

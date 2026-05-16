// Test mod with keybind
console.log('🧪 Testing keybind system...');

if (window.ActivePolyModLoader) {
  console.log('✅ ActivePolyModLoader found!');

  const keybindTestMod = {
    modName: 'Keybind Test',
    modID: 'keybind-test',
    modVersion: '1.0',
    modAuthor: 'TS PML',
    init: (pml) => {
      console.log('🚀 Keybind test mod init called!');
      console.log('🚀 pml.registerKeybind type:', typeof pml.registerKeybind);

      try {
        // Register Y key to test
        pml.registerKeybind(
          'Test Action',
          'testAction',
          'keydown',
          'KeyY',
          null,
          () => {
            console.log('🎉 Y key pressed! TS PML keybinds work!');
            alert('🎉 Y KEY WORKS! TS PML keybind system is functional!');
          }
        );
        console.log('✅ Keybind registered! Press Y in-game to test!');
      } catch (err) {
        console.error('❌ Failed to register keybind:', err);
      }
    }
  };

  try {
    window.ActivePolyModLoader.registerMod(keybindTestMod);
    console.log('✅ Keybind test mod registered!');

    // Call initMods to trigger lifecycle hooks
    window.ActivePolyModLoader.initMods();
    console.log('🎮 Press Y in the game to test the keybind!');
  } catch (err) {
    console.error('❌ Failed to register mod:', err);
  }
} else {
  console.error('❌ ActivePolyModLoader NOT found!');
}

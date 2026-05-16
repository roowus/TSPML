/**
 * TS PML Automated Test Suite
 * Tests all core functionality automatically
 */

class TS_PML_Tests {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  assert(condition, testName) {
    if (condition) {
      this.passed++;
      this.results.push({ test: testName, status: '✅ PASS' });
      console.log(`✅ PASS: ${testName}`);
    } else {
      this.failed++;
      this.results.push({ test: testName, status: '❌ FAIL' });
      console.error(`❌ FAIL: ${testName}`);
    }
  }

  assertEqual(actual, expected, testName) {
    const pass = actual === expected;
    this.assert(pass, testName + ` (expected: ${expected}, got: ${actual})`);
  }

  assertExists(value, testName) {
    this.assert(value !== null && value !== undefined, testName);
  }

  assertThrows(fn, testName) {
    try {
      fn();
      this.assert(false, testName + ' (should have thrown error)');
    } catch (e) {
      this.assert(true, testName + ' (correctly threw error)');
    }
  }

  async runAllTests() {
    console.log('🧪 Starting TS PML Automated Test Suite...\n');

    await this.test_CoreFunctionality();
    await this.test_SingleMod();
    await this.test_MultipleMods();
    await this.test_LifecycleHooks();
    await this.test_KeybindSystem();
    await this.test_SettingsSystem();
    await this.test_MixinSystem();
    await this.test_ErrorHandling();
    await this.test_ModConflicts();
    await this.test_EdgeCases();

    this.printSummary();
  }

  async test_CoreFunctionality() {
    console.log('\n📋 Testing Core Functionality...');

    // Test 1: ActivePolyModLoader exists
    this.assertExists(window.ActivePolyModLoader, 'ActivePolyModLoader exists');

    // Test 2: PolyModLoader alias exists
    this.assertExists(window.polyModLoader, 'polyModLoader alias exists');

    // Test 3: Version info
    this.assertExists(window.ActivePolyModLoader.polyVersion, 'polyVersion exists');
    this.assertExists(window.ActivePolyModLoader._pmlVersion, 'pmlVersion exists');

    // Test 4: Core methods exist
    this.assert(typeof window.ActivePolyModLoader.registerMod === 'function', 'registerMod is function');
    this.assert(typeof window.ActivePolyModLoader.registerKeybind === 'function', 'registerKeybind is function');
    this.assert(typeof window.ActivePolyModLoader.registerSetting === 'function', 'registerSetting is function');
    this.assert(typeof window.ActivePolyModLoader.initMods === 'function', 'initMods is function');

    // Test 5: Mod storage is empty initially
    this.assertEqual(window.ActivePolyModLoader.allMods.size, 0, 'allMods is empty initially');
  }

  async test_SingleMod() {
    console.log('\n📋 Testing Single Mod...');

    // Create test mod
    const testMod1 = {
      modName: 'Test Mod 1',
      modID: 'test-mod-1',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      preInitCalled: false,
      initCalled: false,
      postInitCalled: false,

      preInit: (pml) => {
        testMod1.preInitCalled = true;
      },
      init: (pml) => {
        testMod1.initCalled = true;
      },
      postInit: () => {
        testMod1.postInitCalled = true;
      }
    };

    // Register mod
    window.ActivePolyModLoader.registerMod(testMod1);
    this.assert(window.ActivePolyModLoader.allMods.has('test-mod-1'), 'Mod registered in allMods');

    // Get mod
    const retrieved = window.ActivePolyModLoader.getMod('test-mod-1');
    this.assertEqual(retrieved.modID, 'test-mod-1', 'getMod returns correct mod');

    // Initialize mods
    window.ActivePolyModLoader.initMods();
    this.assert(testMod1.preInitCalled, 'preInit hook called');
    this.assert(testMod1.initCalled, 'init hook called');
    this.assert(testMod1.postInitCalled, 'postInit hook called');
  }

  async test_MultipleMods() {
    console.log('\n📋 Testing Multiple Mods...');

    // Create multiple mods
    const mod2 = {
      modName: 'Test Mod 2',
      modID: 'test-mod-2',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {}
    };

    const mod3 = {
      modName: 'Test Mod 3',
      modID: 'test-mod-3',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {}
    };

    // Register multiple mods
    window.ActivePolyModLoader.registerMod(mod2);
    window.ActivePolyModLoader.registerMod(mod3);

    this.assertEqual(window.ActivePolyModLoader.allMods.size, 3, 'Multiple mods registered');
    this.assert(window.ActivePolyModLoader.getMod('test-mod-2') !== undefined, 'Mod 2 accessible');
    this.assert(window.ActivePolyModLoader.getMod('test-mod-3') !== undefined, 'Mod 3 accessible');

    // Check getAllMods
    const allMods = window.ActivePolyModLoader.getAllMods;
    this.assert(Array.isArray(allMods), 'getAllMods returns array');
    this.assert(allMods.length >= 3, 'getAllMods returns all mods');
  }

  async test_LifecycleHooks() {
    console.log('\n📋 Testing Lifecycle Hooks...');

    const lifecycleOrder = [];
    const lifecycleMod = {
      modName: 'Lifecycle Test',
      modID: 'lifecycle-test',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',

      preInit: (pml) => {
        lifecycleOrder.push('preInit');
      },
      init: (pml) => {
        lifecycleOrder.push('init');
      },
      postInit: () => {
        lifecycleOrder.push('postInit');
      }
    };

    window.ActivePolyModLoader.registerMod(lifecycleMod);
    window.ActivePolyModLoader.initMods();

    // Check order: preInit → init → postInit
    this.assertEqual(lifecycleOrder[0], 'preInit', 'preInit runs first');
    this.assertEqual(lifecycleOrder[1], 'init', 'init runs second');
    this.assertEqual(lifecycleOrder[2], 'postInit', 'postInit runs third');
  }

  async test_KeybindSystem() {
    console.log('\n📋 Testing Keybind System...');

    let keybindTriggered = false;
    const keybindMod = {
      modName: 'Keybind Test',
      modID: 'keybind-test-auto',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {
        pml.registerKeybind(
          'Test Keybind',
          'test-keybind-auto',
          'keydown',
          'KeyK',
          null,
          () => {
            keybindTriggered = true;
          }
        );
      }
    };

    window.ActivePolyModLoader.registerMod(keybindMod);
    window.ActivePolyModLoader.initMods();

    // Check keybind was registered
    this.assert(window.ActivePolyModLoader.keybindings.has('test-keybind-auto'), 'Keybind registered');

    // Check event listener is set up
    this.assert(window.ActivePolyModLoader._keybindListenerSetup === true, 'Keybind listener setup');

    console.log('  ℹ️  Note: Actual key press test requires manual interaction');
  }

  async test_SettingsSystem() {
    console.log('\n📋 Testing Settings System...');

    const settingsMod = {
      modName: 'Settings Test',
      modID: 'settings-test',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {
        pml.registerSetting('Test Setting', 'test-setting', 3, 'option1');
      }
    };

    window.ActivePolyModLoader.registerMod(settingsMod);
    window.ActivePolyModLoader.initMods();

    // Check setting was registered
    this.assert(window.ActivePolyModLoader.settings.has('test-setting'), 'Setting registered');

    // Test getSetting
    const setting = window.ActivePolyModLoader.getSetting('test-setting');
    this.assert(setting !== null, 'getSetting returns value');
  }

  async test_MixinSystem() {
    console.log('\n📋 Testing Mixin System...');

    // Test global mixin
    const mixinId = window.ActivePolyModLoader.registerGlobalMixin({
      search: 'test',
      replace: 'replacement',
      type: 'HEAD'
    });

    this.assertExists(mixinId, 'registerGlobalMixin returns ID');
    this.assert(window.ActivePolyModLoader.mixins.length > 0, 'Mixin added to array');

    // Test func mixin
    const funcMixinId = window.ActivePolyModLoader.registerFuncMixin('test.path', {
      search: 'test',
      replace: 'replacement'
    });

    this.assertExists(funcMixinId, 'registerFuncMixin returns ID');

    // Test sim worker mixin
    const simMixinId = window.ActivePolyModLoader.registerSimWorkerMixin({
      search: 'test',
      replace: 'replacement'
    });

    this.assertExists(simMixinId, 'registerSimWorkerMixin returns ID');
    this.assert(window.ActivePolyModLoader.simWorkerMixins.length > 0, 'Sim worker mixin added');
  }

  async test_ErrorHandling() {
    console.log('\n📋 Testing Error Handling...');

    // Test mod with error in preInit
    const errorMod = {
      modName: 'Error Test',
      modID: 'error-test',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      preInit: (pml) => {
        throw new Error('Test error in preInit');
      },
      init: (pml) => {
        // This should still be called despite error in preInit
        errorMod.initCalled = true;
      }
    };

    // Register error mod - should not crash
    window.ActivePolyModLoader.registerMod(errorMod);
    window.ActivePolyModLoader.initMods();

    // Error should be caught and logged, but init should still be called
    this.assert(errorMod.initCalled === true, 'Other mods continue after error');
  }

  async test_ModConflicts() {
    console.log('\n📋 Testing Mod Conflicts...');

    // Register two mods with same ID
    const conflictMod1 = {
      modName: 'Conflict Test 1',
      modID: 'conflict-test',
      modVersion: '1.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {}
    };

    const conflictMod2 = {
      modName: 'Conflict Test 2',
      modID: 'conflict-test',  // Same ID
      modVersion: '2.0.0',
      modAuthor: 'Test Suite',
      init: (pml) => {}
    };

    window.ActivePolyModLoader.registerMod(conflictMod1);
    window.ActivePolyModLoader.registerMod(conflictMod2);

    // Second mod should overwrite first (Map behavior)
    const retrieved = window.ActivePolyModLoader.getMod('conflict-test');
    this.assertEqual(retrieved.modVersion, '2.0.0', 'Later mod overwrites earlier mod with same ID');
  }

  async test_EdgeCases() {
    console.log('\n📋 Testing Edge Cases...');

    // Test getting non-existent mod
    const nonExistent = window.ActivePolyModLoader.getMod('does-not-exist');
    this.assert(nonExistent === undefined, 'getMod returns undefined for non-existent mod');

    // Test mod without modID (should throw error)
    const invalidMod1 = {
      modName: 'Invalid Mod',
      // Missing modID
      modVersion: '1.0.0'
    };

    this.assertThrows(() => {
      window.ActivePolyModLoader.registerMod(invalidMod1);
    }, 'Registering mod without modID throws error');

    // Test mod without modName (should throw error)
    const invalidMod2 = {
      // Missing modName
      modID: 'invalid-mod-2',
      modVersion: '1.0.0'
    };

    this.assertThrows(() => {
      window.ActivePolyModLoader.registerMod(invalidMod2);
    }, 'Registering mod without modName throws error');

    // Test valid mod without lifecycle hooks (should work)
    const minimalMod = {
      modName: 'Minimal',
      modID: 'minimal-mod',
      modVersion: '1.0.0',
      modAuthor: 'Test'
    };

    window.ActivePolyModLoader.registerMod(minimalMod);
    this.assert(window.ActivePolyModLoader.allMods.has('minimal-mod'), 'Mod without lifecycle hooks registers successfully');

    // Test empty mod list initialization
    const initialSize = window.ActivePolyModLoader.allMods.size;
    window.ActivePolyModLoader.initMods();  // Should not crash
    this.assert(true, 'initMods with existing mods does not crash');
  }

  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Total:  ${this.passed + this.failed}`);
    console.log(`🎯 Success Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(50));

    if (this.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => r.status === '❌ FAIL').forEach(r => {
        console.log(`  - ${r.test}`);
      });
    }

    const allPassed = this.failed === 0;
    if (allPassed) {
      console.log('\n🎉 ALL TESTS PASSED! TS PML is robust and ready!');
    } else {
      console.log('\n⚠️  Some tests failed. Review and fix issues.');
    }

    console.log('\n');

    return allPassed;
  }
}

// Run tests automatically
console.log('🚀 Initializing TS PML Automated Test Suite...');

// Wait for TS PML to be ready
setTimeout(() => {
  if (!window.ActivePolyModLoader) {
    console.error('❌ TS PML not loaded! Cannot run tests.');
    return;
  }

  const tests = new TS_PML_Tests();
  tests.runAllTests().then((allPassed) => {
    if (allPassed) {
      console.log('✅ TS PML v0.0.1 is PRODUCTION READY!');
    }
  });
}, 1000);

/**
 * Test Worker Communication
 * Verifies that WASM is captured in worker and we can communicate with it
 */

function testWorkerCommunication() {
  console.log('%c🧪 Testing Worker Communication...', 'color: #ff0; font-size: 14px');

  // Check if worker WASM is ready
  if (window.__TS_PML_WORKER_WASM_READY__) {
    console.log('%c✅ Worker WASM is ready!', 'color: #0f0');
    console.log('   Worker reference:', window.__TS_PML_WORKER__);
  } else {
    console.log('%c⏳ Worker WASM not ready yet - waiting for game to load physics...', 'color: #ff0');
    console.log('   Start a race to trigger WASM loading!');
  }

  // Listen for WASM ready event
  window.addEventListener('__TS_PML_WASM_READY__', function(event) {
    console.log('%c✅✅✅ WASM READY EVENT FIRED! ✅✅✅', 'color: #0f0; font-size: 20px; font-weight: bold');
    console.log('   Detail:', event.detail);
  });

  // Test memory read function
  window.testMemoryRead = function(offset, type) {
    if (!window.__TS_PML_WORKER__) {
      console.error('❌ Worker not available');
      return;
    }

    type = type || 'float32';
    console.log('📖 Reading memory at offset', offset, 'as', type);

    window.__TS_PML_WORKER__.postMessage({
      type: '__TS_PML_MEMORY_READ__',
      offset: offset,
      type: type
    });
  };

  // Test memory write function
  window.testMemoryWrite = function(offset, value, type) {
    if (!window.__TS_PML_WORKER__) {
      console.error('❌ Worker not available');
      return;
    }

    type = type || 'float32';
    console.log('✏️ Writing memory at offset', offset, '=', value, 'as', type);

    window.__TS_PML_WORKER__.postMessage({
      type: '__TS_PML_MEMORY_WRITE__',
      offset: offset,
      value: value,
      type: type
    });
  };

  // Listen for memory responses
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === '__TS_PML_MEMORY_VALUE__') {
      console.log('📖 Memory value:', event.data);
    }
    if (event.data && event.data.type === '__TS_PML_MEMORY_WRITTEN__') {
      console.log('✏️ Memory written:', event.data);
    }
  });

  console.log('%c✅ Worker communication test utilities ready!', 'color: #0f0');
  console.log('%c   Use: testMemoryRead(offset, type) and testMemoryWrite(offset, value, type)', 'color: #0f0');
  console.log('%c   Example: testMemoryRead(0, "float32")', 'color: #0f0');

  return {
    testMemoryRead: window.testMemoryRead,
    testMemoryWrite: window.testMemoryWrite,
    isReady: () => window.__TS_PML_WORKER_WASM_READY__ || false
  };
}

// Auto-run when injected
console.log('%c🧪 Worker Communication Test Loaded!', 'color: #ff0; font-size: 14px');
console.log('%c   Run testWorkerCommunication() to start testing', 'color: #ff0');

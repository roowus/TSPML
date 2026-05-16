// WASM Memory Scanner for finding car state offsets
// Load this in the console while in a race to scan for car position/velocity

(function() {
  'use strict';

  var scanner = {
    previousMemory: null,
    memorySize: 1114112, // 1.06 MB

    // Read a chunk of memory (returns Promise)
    readMemoryChunk: function(offset, length) {
      return __TS_PML_MEMORY__.readChunk(offset, length);
    },

    // Helper: Convert hex string to Uint8Array
    hexToBytes: function(hex) {
      if (typeof hex !== 'string') {
        console.error('hexToBytes: expected string, got', typeof hex, hex);
        return new Uint8Array(0);
      }
      hex = hex.replace(/\s+/g, '');
      var bytes = new Uint8Array(hex.length / 2);
      for (var i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
    },

    // Helper: Read float32 from byte array
    readFloat32: function(bytes, offset) {
      var view = new DataView(bytes.buffer, offset, 4);
      return view.getFloat32(0, true); // little-endian
    },

    // Take a snapshot of current memory state
    snapshot: function() {
      var self = this;
      console.log('📸 Taking memory snapshot...');
      return this.readMemoryChunk(0, Math.min(65536, this.memorySize)).then(function(data) {
        self.previousMemory = data;
        console.log('✅ Snapshot taken');
      });
    },

    // Compare current memory with snapshot
    compare: function() {
      var self = this;
      if (!this.previousMemory) {
        console.log('❌ No snapshot available. Run __TS_PML_SCANNER__.snapshot() first.');
        return Promise.reject('No snapshot');
      }

      console.log('🔍 Comparing memory with snapshot...');
      return this.readMemoryChunk(0, Math.min(65536, this.memorySize)).then(function(currentMemory) {
        var oldArr = self.hexToBytes(self.previousMemory);
        var newArr = self.hexToBytes(currentMemory);
        var changes = [];

        // Scan for float32 changes
        for (var i = 0; i < Math.min(oldArr.length, newArr.length) - 4; i += 4) {
          var oldValue = self.readFloat32(oldArr, i);
          var newValue = self.readFloat32(newArr, i);

          if (Math.abs(newValue - oldValue) > 0.001) {
            changes.push({
              offset: i,
              oldValue: oldValue,
              newValue: newValue
            });
          }
        }

        console.log('📊 Found ' + changes.length + ' changed float values:');
        changes.forEach(function(change) {
          console.log('  Offset 0x' + change.offset.toString(16).padStart(6, '0') +
                      ': ' + change.oldValue.toFixed(4) + ' → ' + change.newValue.toFixed(4));
        });

        return changes;
      });
    },

    // Scan memory for patterns (async)
    scanForFloatsInRange: function(startOffset, endOffset, min, max) {
      var self = this;
      var results = [];
      var chunkSize = 4096;
      var offset = startOffset;

      function scanNext() {
        if (offset >= endOffset) {
          return Promise.resolve(results);
        }

        var length = Math.min(chunkSize, endOffset - offset);
        return self.readMemoryChunk(offset, length).then(function(chunk) {
          var bytes = self.hexToBytes(chunk);
          for (var i = 0; i < bytes.length - 4; i += 4) {
            var value = self.readFloat32(bytes, i);
            if (value >= min && value <= max) {
              results.push({
                offset: offset + i,
                value: value
              });
            }
          }
          offset += chunkSize;
          return scanNext();
        });
      }

      return scanNext();
    },

    // Quick scan for position-like values (typically -1000 to 1000 for coordinates)
    scanForPositions: function() {
      console.log('🔍 Scanning for position-like values (-100 to 100)...');
      var self = this;
      return this.scanForFloatsInRange(0, 65536, -100, 100).then(function(results) {
        console.log('📊 Found ' + results.length + ' position-like values:');
        results.slice(0, 50).forEach(function(r) {
          console.log('  Offset 0x' + r.offset.toString(16).padStart(6, '0') + ': ' + r.value.toFixed(4));
        });
        return results;
      });
    },

    // Monitor a specific offset
    monitorOffset: function(offset, name) {
      name = name || 'Offset';
      var lastValue = null;

      var interval = setInterval(function() {
        __TS_PML_MEMORY__.readFloat32(offset).then(function(value) {
          if (lastValue !== null && Math.abs(value - lastValue) > 0.0001) {
            console.log(name + ' [0x' + offset.toString(16) + ']: ' +
                        lastValue.toFixed(6) + ' → ' + value.toFixed(6));
          }
          lastValue = value;
        });
      }, 100);

      return {
        stop: function() { clearInterval(interval); }
      };
    }
  };

  window.__TS_PML_SCANNER__ = scanner;
  console.log('✅ Memory scanner loaded!');
  console.log('📖 Usage:');
  console.log('  __TS_PML_SCANNER__.snapshot() - Take memory snapshot (returns Promise)');
  console.log('  __TS_PML_SCANNER__.compare() - Compare with snapshot (returns Promise)');
  console.log('  __TS_PML_SCANNER__.scanForPositions() - Find position-like values (returns Promise)');
  console.log('  __TS_PML_SCANNER__.monitorOffset(offset, name) - Monitor an offset');
  console.log('');
  console.log('🎯 Quick start:');
  console.log('  1. Start a race');
  console.log('  2. Run: await __TS_PML_SCANNER__.scanForPositions()');
  console.log('  3. Move your car');
  console.log('  4. Run: await __TS_PML_SCANNER__.compare()');
})();

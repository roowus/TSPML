/**
 * A hand-written SYNTHETIC webpack-style bundle fixture for CI-runnable tests.
 *
 * The real PolyTrack 0.6.2 main bundle (1.78 MB) is gitignored and machine-local,
 * so the spike's `spike.test.mjs` skips on CI. These fixtures mirror the SAME
 * structural shape the spike validated on the real bundle — a webpack bootstrap
 * IIFE `(()=>{...})()` wrapping a module map `{ <id>: (e,t,n)=>{...} }` — at a
 * size tests can hold in source. The anchor/selector strategy exercised here is
 * identical to the real-bundle one (docs/research/transform-spike.md).
 *
 * Nothing here needs to actually EXECUTE; it must parse + have the right shape.
 */

/** The enum anchor unique to the Car module (TS-compiled protocol enum members). */
export const CAR_ANCHOR = ["CreateCar", "ControlCar", "TestDeterminism"] as const;

/**
 * The synthetic bundle. Three modules:
 *   111  — a plain module (no car anchor; proves anchor uniqueness).
 *   5220 — the Car physics-protocol module: the enum anchor, a `version`
 *          ObjectProperty (selected by KEY), and a `controlCar` ClassMethod.
 *   7331 — a sibling that ALSO has a `version:"0.6.2"` property and an `update`
 *          method, proving the locator's module-scoping prevents cross-module
 *          collisions (the drift-spike rationale for anchoring first).
 */
export const SYNTHETIC_BUNDLE = `
(() => {
  const __webpack_modules__ = {
    111: (module, exports, __webpack_require__) => {
      const greet = () => "hello";
      module.exports = { greet };
    },
    5220: (module, exports, __webpack_require__) => {
      // TS-compiled numeric enum: the member names appear as STRING LITERALS
      // (E["CreateCar"]=0) ... ="CreateCar"), which survive minification and are
      // globally unique to this module — exactly the anchor the spike relied on.
      const CarProtocol = (function (E) {
        E[(E["CreateCar"] = 0)] = "CreateCar";
        E[(E["ControlCar"] = 1)] = "ControlCar";
        E[(E["TestDeterminism"] = 2)] = "TestDeterminism";
        return E;
      })({});
      const config = { version: "0.6.2", maxSpeed: 300 };
      class Car {
        controlCar(input) {
          const force = applyForce(input, 9.8);
          return force;
        }
        reset() {
          this.state = 0;
        }
      }
      function applyForce(x, g) {
        return x * g;
      }
      module.exports = { Car, CarProtocol, config };
    },
    7331: (module, exports, __webpack_require__) => {
      const meta = { version: "0.6.2" };
      const obj = { update() { return 1; } };
      module.exports = { meta, obj };
    },
  };
  function __webpack_require__(id) {
    return __webpack_modules__[id];
  }
  __webpack_require__(111);
})();
`;

/** A target spec for the Car.controlCar method. */
export const CAR_CONTROL_CAR = {
  anchor: { literals: [...CAR_ANCHOR] },
  selector: { kind: "method" as const, name: "controlCar" },
};

/** A target spec for the Car module's `config.version` property. */
export const CAR_VERSION = {
  anchor: { literals: [...CAR_ANCHOR] },
  selector: { kind: "property" as const, key: "version" },
};

/** A target spec for the Car module's webpack factory itself. */
export const CAR_FACTORY = {
  anchor: { literals: [...CAR_ANCHOR] },
  selector: { kind: "factory" as const },
};

/** Two distinct sha256-shaped hashes for fail-closed tests. */
export const HASH_LIVE = "sha256:" + "a".repeat(64);
export const HASH_OTHER = "sha256:" + "b".repeat(64);

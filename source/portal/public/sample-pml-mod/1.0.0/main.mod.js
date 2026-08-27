// A PML-format mod, written the way PML mods are actually written — this file
// is the fixture `smoke:pml` imports, and every line of it is load-bearing.
//
//  - the first line is a RELATIVE import of "./PolyModLoader.js", which resolves
//    to nothing against the blob: URL TSPML imports mod code from. It only works
//    because `lib/pml/wrap.ts` rewrites it to read the adapter off a global.
//  - the hooks are CLASS PROPERTIES, not prototype methods, because that is what
//    PML mods write and it is why `lib/pml/shim.ts`'s `PolyMod` base defines no
//    hooks of its own (a class property would shadow them).
//  - `registerKeybind`'s key is a `KeyboardEvent.code` ("KeyJ"), which is what
//    `Keybinds.dispatch` compares against.
//  - the `registerClassMixin` call MUST be refused, by name, without taking the
//    rest of the mod down. That is the whole compatibility contract.
//  - the file ends in `export let polyMod = new …()`, PML's export convention.
//
// Every observable is stamped on `window` in the MAIN frame (mod code is
// imported into the page's realm, not the game iframe's).
import { PolyMod, MixinType } from "./PolyModLoader.js";

class SamplePmlMod extends PolyMod {
  preInit = () => {
    window.__smokePmlPhases = [...(window.__smokePmlPhases || []), "preInit"];
  };

  init = (pml) => {
    window.__smokePmlPhases = [...(window.__smokePmlPhases || []), "init"];
    // The loader wrote these onto the instance before any hook ran.
    window.__smokePmlIdentity = `${this.getID()}/${this.getName()}/${this.getVersion()}`;

    // A real registration, through api.keybinds. "KeyJ" is a KeyboardEvent.code.
    pml.registerKeybind({
      id: "smoke",
      key: "KeyJ",
      onPress: () => {
        window.__smokePmlKey = (window.__smokePmlKey || 0) + 1;
      },
    });

    // Settings are stored and headless — and `getSetting` returns a STRING even
    // for a bool, a PML wart reproduced on purpose.
    pml.registerSetting({ id: "smokeFlag", value: true });
    window.__smokePmlSetting = pml.getSetting("smokeFlag");

    // Untranslatable, and therefore refused per call with a reason. The mod
    // keeps running: everything below this line still happens.
    pml.registerClassMixin(
      "SmokeTarget",
      "prototype",
      MixinType.INSERT,
      "someToken",
      "void 0;",
    );

    window.__smokePmlSurvivedMixin = true;
  };

  postInit = () => {
    window.__smokePmlPhases = [...(window.__smokePmlPhases || []), "postInit"];
  };

  onGameLoad = () => {
    window.__smokePmlPhases = [...(window.__smokePmlPhases || []), "onGameLoad"];
  };
}

export let polyMod = new SamplePmlMod();

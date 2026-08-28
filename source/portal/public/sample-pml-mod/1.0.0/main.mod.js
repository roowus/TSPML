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
//  - the mixin registrations cover BOTH halves of the contract: one real,
//    collectable splice (object-spec form, as actual PML mods on the CDN
//    write them — ghosttoggle 1.0.8 is the reference) whose token exists
//    exactly once in the vanilla 0.6.2 main bundle and executes at eval, and
//    two refusals — an untranslatable TYPE (method-extent) and an
//    untranslatable FAMILY (global mixin). Every refusal is per call; the mod
//    keeps running past all of them.
//  - the file ends in `export let polyMod = new …()`, PML's export convention.
//
// Every observable is stamped on `window` in the MAIN frame (mod code is
// imported into the page's realm, not the game iframe's) — except
// `__pmlSpliceRan`, which the SPLICE itself stamps in the GAME frame: it only
// exists after the collected mixin rides the plan and the served bundle is
// re-fetched with it, which is the second launch.
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

    // A REAL splice, in the object-spec form PML mods actually ship. The token
    // is the game's own FPS-counter keybind registration — present exactly
    // once in the vanilla 0.6.2 main bundle and executed when the bundle
    // evaluates, so the inserted counter is observable proof the splice RAN,
    // not merely that it was accepted. The func is a PARENTHESIZED EXPRESSION
    // with no leading semicolon, because the token sits inside the entry's
    // comma-expression sequence — a `;`-statement there is a syntax error, and
    // writing the func to fit its insertion context is exactly the discipline
    // a real PML author's func carries (the fail-closed re-parse gate rejects
    // the bundle otherwise and the game boots vanilla instead).
    pml.registerClassMixin("entry", "boot", {
      type: MixinType.INSERT,
      token: 'window.addEventListener("keyup",(e=>{r.checkKeyBinding(e,ge.A.ToggleFpsCounter)&&M.toggle()}))',
      func: '(window.__pmlSpliceRan=(window.__pmlSpliceRan||0)+1)',
    });

    // Refused by TYPE: OVERRIDE anchors to a method's extent, which needs the
    // live class PML resolves against — no token to verify, so no way to apply
    // it faithfully. Refused per call, with that reason.
    pml.registerClassMixin("SmokeTarget", "prototype", {
      type: MixinType.OVERRIDE,
      func: "void 0;",
    });

    // Refused by FAMILY: global mixins anchor to module scope this adapter
    // never holds.
    pml.registerGlobalMixin("SmokeTarget", "prototype", {
      type: MixinType.INSERT,
      token: "someToken",
      func: "void 0;",
    });

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

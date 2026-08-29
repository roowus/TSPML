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
//  - the mixin registrations cover BOTH halves of the contract: three real,
//    collectable splices — one per shape the CDN mods actually ship (class +
//    string enum, class + PML's numeric enum, global lone-object twin-anchor)
//    — and two refusals (an untranslatable TYPE and a call with no spec).
//    Every refusal is per call; the mod keeps running past all of them.
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

    // Three real splice shapes, one per CDN mod that ships it. Together they
    // pin the whole collector: the string-enum dialect, PML's NUMERIC enum,
    // the (name, spec) form, the lone-object global form, and twin anchors.
    // Each token was measured exactly-once in the vanilla 0.6.2 bundle and
    // runs (or lands) where the bundle evaluates.
    //
    // 1. Class family, two strings + object spec, our string enum — the
    //    ghosttoggle shape. The func is COMMA-PREFIXED and parenthesized
    //    because the token sits inside the entry's comma-expression sequence:
    //    a `;`-statement there is a syntax error (vanilla boot), and a bare
    //    parenthesized expression is worse — it PARSES as a call of the
    //    preceding call's result, sets the marker, then throws and truncates
    //    the game's boot tail. The leading comma is the only spelling that
    //    both parses and behaves.
    pml.registerClassMixin("entry", "boot", {
      type: MixinType.INSERT,
      token: 'window.addEventListener("keyup",(e=>{r.checkKeyBinding(e,ge.A.ToggleFpsCounter)&&M.toggle()}))',
      func: ',(window.__pmlSpliceRan=(window.__pmlSpliceRan||0)+1)',
    });
    // 2. Class family with PML's NUMERIC enum (INSERT === 3) — what every mod
    //    that imports PolyTypes.js from the CDN actually puts in `type`. The
    //    animation-loop registration runs at bundle eval (unlike, say, the
    //    verifier error paths, which are lazy), and it sits in the entry's
    //    comma sequence — same comma-prefix discipline as #1. Second marker,
    //    second dialect.
    pml.registerClassMixin("entry", "loop", {
      type: 3,
      token: 'd.setAnimationLoop((function(e){const t=Math.max(e-ee,0)/1e3;ee=e,$.update(t),M.update(t)}))',
      func: ',(window.__pmlSpliceRan2 = 1)',
    });
    // 3. Global family, LONE object spec — noitalics' exact shape and token:
    //    a twin-anchor REPLACEBETWEEN over the game's own italic style string.
    pml.registerGlobalMixin({
      type: MixinType.REPLACEBETWEEN,
      tokenStart: 'font-style: italic;',
      tokenEnd: 'font-style: italic;',
      func: 'font-style: normal;',
    });

    // Refused by TYPE: OVERRIDE anchors to a method's extent, which needs the
    // live class PML resolves against — no token to verify, so no way to apply
    // it faithfully. Refused per call, with that reason.
    pml.registerClassMixin("SmokeTarget", "prototype", {
      type: MixinType.OVERRIDE,
      func: "void 0;",
    });

    // Refused by SHAPE: no spec object at all (an older positional call).
    pml.registerFuncMixin("uf", "prototype");

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

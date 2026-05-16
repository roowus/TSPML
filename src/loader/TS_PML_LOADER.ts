/**
 * TS PML - The Second Poly Mod Loader
 * Direct replacement for PolyModLoader.js
 * This file provides the same interface but uses TS PML internally
 */

// ============================================================================
// CORE TSPML SYSTEMS (will be imported from compiled bundle)
// ============================================================================

class TSPMLCore {
    constructor(polyVersion, pmlVersion) {
        this.polyVersion = polyVersion;
        this.pmlVersion = pmlVersion;
        this.mods = new Map();
        this.mixins = [];
        this.settings = new Map();
        this.keybindings = new Map();
        this.debugMode = true;
    }

    log(message) {
        if (this.debugMode) {
            console.log(`[TS PML] ${message}`);
        }
    }

    registerMod(mod) {
        this.mods.set(mod.modID, mod);
        this.log(`Registered mod: ${mod.modName} v${mod.modVersion}`);
    }

    getMod(modID) {
        return this.mods.get(modID);
    }

    getAllMods() {
        return Array.from(this.mods.values());
    }
}

// ============================================================================
// POLYMODLOADER COMPATIBILITY LAYER
// ============================================================================

class PolyModLoaderImpl {
    constructor(polyVersion, pmlVersion) {
        this._polyVersion = polyVersion;
        this._pmlVersion = pmlVersion;

        // Initialize TS PML core
        this.core = new TSPMLCore(polyVersion, pmlVersion);

        // Mod storage
        this.allMods = new Map();
        this.simWorkerMixins = [];
        this.physicsMixins = [];
        this.chunkMixins = [];

        // Settings
        this.settingConstructor = null;
        this.defaultSettings = new Map();
        this.latestSetting = new Map();

        // Keybinds
        this.bindConstructor = null;
        this.defaultBinds = new Map();
        this.latestBinding = new Map();
        this.keybindings = new Map();

        // Mod URLs
        this.polyModUrls = [];

        this.log(`TS PML ${pmlVersion} initialized for PolyTrack ${polyVersion}`);
    }

    log(msg) {
        console.log(`[TS PML] ${msg}`);
    }

    // Version info
    get polyVersion() {
        return this._polyVersion;
    }

    // Mod management
    get getAllMods() {
        return Array.from(this.allMods.values());
    }

    getMod(modID) {
        return this.allMods.get(modID);
    }

    registerMod(mod) {
        this.allMods.set(mod.modID, mod);
        this.core.registerMod(mod);
    }

    // Lifecycle hooks
    initMods() {
        this.log(`Initializing ${this.allMods.size} mods...`);

        for (const [id, mod] of this.allMods) {
            try {
                // Call mod lifecycle hooks in order
                if (mod.preInit) {
                    mod.preInit(this);
                }
            } catch (error) {
                console.error(`[TS PML] Error in ${id}.preInit():`, error);
            }
        }

        for (const [id, mod] of this.allMods) {
            try {
                if (mod.init) {
                    mod.init(this);
                }
            } catch (error) {
                console.error(`[TS PML] Error in ${id}.init():`, error);
            }
        }

        for (const [id, mod] of this.allMods) {
            try {
                if (mod.postInit) {
                    mod.postInit();
                }
            } catch (error) {
                console.error(`[TS PML] Error in ${id}.postInit():`, error);
            }
        }

        this.log('All mods initialized!');
    }

    preInitMods() {
        this.log('Pre-initializing mods...');
    }

    postInitMods() {
        this.log('Post-initializing mods...');
        for (const [id, mod] of this.allMods) {
            try {
                if (mod.onGameLoad) {
                    mod.onGameLoad();
                }
            } catch (error) {
                console.error(`[TS PML] Error in ${id}.onGameLoad():`, error);
            }
        }
    }

    // Mixin system
    registerGlobalMixin(mixinArg) {
        const mixinId = `global_${this.mixins.length}`;
        this.mixins.push({ ...mixinArg, id: mixinId, type: 'global' });
        this.log(`Registered global mixin: ${mixinId}`);
        return mixinId;
    }

    registerFuncMixin(path, mixinArg) {
        const mixinId = `func_${path}_${this.mixins.length}`;
        this.mixins.push({ ...mixinArg, id: mixinId, type: 'func', path });
        this.log(`Registered function mixin: ${mixinId}`);
        return mixinId;
    }

    registerClassMixin(scope, path, mixinArg) {
        const mixinId = `class_${scope}_${path}_${this.mixins.length}`;
        this.mixins.push({ ...mixinArg, id: mixinId, type: 'class', scope, path });
        this.log(`Registered class mixin: ${mixinId}`);
        return mixinId;
    }

    registerSimWorkerMixin(mixinArg) {
        const mixinId = `sim_${this.mixins.length}`;
        this.simWorkerMixins.push({ ...mixinArg, id: mixinId });
        this.log(`Registered sim worker mixin: ${mixinId}`);
        return mixinId;
    }

    // Settings system
    registerSetting(name, id, type, defaultOption, options) {
        const setting = { name, id, type, defaultOption, options };
        this.settings.set(id, setting);
        this.log(`Registered setting: ${name} (${id})`);
    }

    getSetting(id) {
        const setting = this.settings.get(id);
        if (!setting) return null;

        // Try to get from localStorage
        const stored = localStorage.getItem(`pml_setting_${id}`);
        if (stored !== null) {
            return JSON.parse(stored);
        }

        return setting.defaultOption;
    }

    // Keybind system
    registerKeybind(name, id, event, defaultBind, secondBind, callback) {
        const keybind = { name, id, event, defaultBind, secondBind, callback };
        this.keybindings.set(id, keybind);
        this.log(`Registered keybind: ${name} (${defaultBind})`);
    }

    // Game code access
    getFromPolyTrackGlobal(text) {
        try {
            return eval(text);
        } catch (e) {
            console.error('[TS PML] Error evaluating PolyTrack code:', e);
            return undefined;
        }
    }

    // Alias for compatibility
    getFromPolyTrack(text) {
        return this.getFromPolyTrackGlobal(text);
    }

    // Storage (PolyDB)
    get polyDb() {
        const db = {
            async get(key) {
                return localStorage.getItem(`pml_${key}`);
            },
            async set(key, value) {
                localStorage.setItem(`pml_${key}`, value);
            },
            async delete(key) {
                localStorage.removeItem(`pml_${key}`);
            }
        };
        return db;
    }

    // Mod loading
    async importMods() {
        this.log('Importing mods...');
        // Mods will be loaded from URLs or registered directly
    }

    async loadModsFromLauncher() {
        this.log('Loading mods from launcher...');
        // Mods would be loaded here
    }

    // Mod enable/disable
    setModLoaded(mod, loaded) {
        mod.loaded = loaded;
        this.log(`Mod ${mod.modID} ${loaded ? 'enabled' : 'disabled'}`);
    }

    // Game load hook
    gameLoad() {
        this.log('Game loaded!');
        this.postInitMods();
    }
}

// ============================================================================
// INITIALIZE
// ============================================================================

// Use the pmlversion that's already set
const pmlVersion = window.pmlversion || '0.0.1';
const polyVersion = '0.6.0';

// Create the loader instance
const ActivePolyModLoader = new PolyModLoaderImpl(polyVersion, pmlVersion);

// Make it globally available
window.polyModLoader = ActivePolyModLoader;
window.ActivePolyModLoader = ActivePolyModLoader;

// Export for module loading
export { ActivePolyModLoader };

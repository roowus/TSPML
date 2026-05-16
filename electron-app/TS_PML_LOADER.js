var TS_PML_LOADER = (function (exports) {
    'use strict';

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
            this.mixins = [];  // FIX: Initialize mixins array
            // Settings
            this.settingConstructor = null;
            this.defaultSettings = new Map();
            this.latestSetting = new Map();
            this.settings = new Map();  // FIX: Initialize settings Map
            // Keybinds
            this.bindConstructor = null;
            this.defaultBinds = new Map();
            this.latestBinding = new Map();
            this.keybindings = new Map();
            // Mod URLs
            this.polyModUrls = [];
            // Clean API instances
            this.player = null;
            this.physics = null;
            this.ui = null;
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
            // Validate mod has required fields
            if (!mod.modID) {
                throw new Error('Mod must have modID property');
            }
            if (!mod.modName) {
                throw new Error('Mod must have modName property');
            }
            if (!mod.modVersion) {
                throw new Error('Mod must have modVersion property');
            }

            this.allMods.set(mod.modID, mod);
            this.core.registerMod(mod);
        }
        // Lifecycle hooks
        initMods() {
            // Initialize clean API before mod init
            this._initCleanAPI();

            this.log(`Initializing ${this.allMods.size} mods...`);
            for (const [id, mod] of this.allMods) {
                try {
                    // Call mod lifecycle hooks in order
                    if (mod.preInit) {
                        mod.preInit(this);
                    }
                }
                catch (error) {
                    console.error(`[TS PML] Error in ${id}.preInit():`, error);
                }
            }
            for (const [id, mod] of this.allMods) {
                try {
                    if (mod.init) {
                        // Pass this (pml) which now includes clean API
                        mod.init(this);
                    }
                }
                catch (error) {
                    console.error(`[TS PML] Error in ${id}.init():`, error);
                }
            }
            for (const [id, mod] of this.allMods) {
                try {
                    if (mod.postInit) {
                        mod.postInit();
                    }
                }
                catch (error) {
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
                }
                catch (error) {
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
            if (!setting)
                return null;
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

            // Set up event listener if not already done
            if (!this._keybindListenerSetup) {
                this._setupKeybindListener();
                this._keybindListenerSetup = true;
            }
        }

        _setupKeybindListener() {
            this.log('Setting up keyboard event listener...');
            document.addEventListener('keydown', (e) => {
                // Check each keybind
                for (const [id, keybind] of this.keybindings) {
                    if (keybind.event === 'keydown' && e.code === keybind.defaultBind) {
                        this.log(`Keybind triggered: ${keybind.name} (${keybind.defaultBind})`);
                        try {
                            keybind.callback();
                        } catch (err) {
                            console.error(`[TS PML] Error in keybind ${keybind.name}:`, err);
                        }
                        return; // Only trigger one keybind per key
                    }
                }
            });
            this.log('Keyboard event listener active!');
        }
        // Game code access
        getFromPolyTrackGlobal(text) {
            try {
                return eval(text);
            }
            catch (e) {
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

        // ==========================================================================
        // CLEAN API (Simple interface for common operations)
        // ==========================================================================

        /**
         * Initialize clean API instances
         * This creates simple interfaces for mods to use by intercepting car state updates
         */

        /**
         * Initialize clean API with race detection hooks
         */
        _initCleanAPI() {
            if (this._cleanAPIInitialized) {
                return;
            }

            this.log('Initializing clean API with race detection hooks...');

            let searchCount = 0;
            let inRace = false;
            let domObserver = null;

            // Race detection: Monitor URL changes
            const detectRaceStart = () => {
                // Check if URL contains track info
                const url = window.location.href;
                const hasTrack = url.includes('track') || url.includes('play') || url.includes('race');

                // Check for DOM elements that indicate race is active
                const hasRaceUI = document.querySelector('.race-ui') ||
                                 document.querySelector('.hud') ||
                                 document.querySelector('[class*="race"]') ||
                                 document.querySelector('[class*="game"]');

                // Check for canvas (3D rendering usually means game is running)
                const hasCanvas = document.querySelector('canvas');

                if (hasTrack || hasRaceUI || hasCanvas) {
                    if (!inRace) {
                        inRace = true;
                        this.log('[Clean API] 🏁 Race/track detected! Intensifying search...');
                        // Do immediate deep search when race starts
                        this._debugWindowContents();
                        this._quickTargetedSearch();
                        this._broaderPropertySearch();
                        this._deepSearchWithSafeguards();
                    }
                    return true;
                }
                return false;
            };

            // Debug: Show what's actually in window
            this._debugWindowContents = () => {
                try {
                    const carRelatedKeys = [];
                    const gameRelatedKeys = [];

                    for (const key in window) {
                        const lowerKey = key.toLowerCase();
                        if (lowerKey.includes('car') || lowerKey.includes('player') || lowerKey.includes('visual')) {
                            carRelatedKeys.push(key);
                        }
                        if (lowerKey.includes('game') || lowerKey.includes('race') || lowerKey.includes('track') || lowerKey.includes('state')) {
                            gameRelatedKeys.push(key);
                        }
                    }

                    if (carRelatedKeys.length > 0) {
                        this.log(`[DEBUG] Found car-related keys: ${carRelatedKeys.slice(0, 10).join(', ')}`);
                    }
                    if (gameRelatedKeys.length > 0) {
                        this.log(`[DEBUG] Found game-related keys: ${gameRelatedKeys.slice(0, 10).join(', ')}`);
                    }

                    // Check a few promising candidates
                    const candidates = [...carRelatedKeys, ...gameRelatedKeys].slice(0, 5);
                    for (const key of candidates) {
                        try {
                            const val = window[key];
                            if (val && typeof val === 'object') {
                                const keys = Object.keys(val);
                                this.log(`[DEBUG] window.${key} has ${keys.length} properties: ${keys.slice(0, 5).join(', ')}...`);

                                // Check if it has car-like objects inside
                                for (const [k, v] of Object.entries(val)) {
                                    if (v && typeof v === 'object' && typeof v.getSpeedKmh === 'function') {
                                        this.log(`[DEBUG] ✓ Found car at window.${key}.${k}!`);
                                    }
                                }
                            }
                        } catch (e) {}
                    }
                } catch (e) {
                    // Silently fail
                }
            };

            // Monitor DOM changes for race start
            const setupDOMObserver = () => {
                if (domObserver) return;

                try {
                    domObserver = new MutationObserver((mutations) => {
                        detectRaceStart();
                    });

                    domObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });

                    this.log('[Clean API] DOM observer active - will detect race start');
                } catch (e) {
                    this.log('[Clean API] Could not setup DOM observer');
                }
            };

            // Setup DOM observer after page loads
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupDOMObserver);
            } else {
                setupDOMObserver();
            }

            // Continuous search that runs forever
            const continuousSearch = () => {
                if (window.__TS_PML_VISUAL_CAR__) {
                    return; // Found it!
                }

                searchCount++;

                // Try to detect race start
                detectRaceStart();

                // If in race, search more aggressively
                if (inRace) {
                    // Every second when in race
                    this._quickTargetedSearch();
                    if (searchCount % 2 === 0) {
                        this._broaderPropertySearch();
                    }
                    if (searchCount % 5 === 0) {
                        this._deepSearchWithSafeguards();
                    }
                } else {
                    // Light search when not in race
                    this._quickTargetedSearch();
                    // Every 5 seconds, try broader search
                    if (searchCount % 5 === 0) {
                        this._broaderPropertySearch();
                        this._deepSearchWithSafeguards();
                    }
                }

                // Log status every 30 seconds
                if (searchCount % 30 === 0 && !inRace) {
                    this.log(`[Clean API] Still searching... (${searchCount}s elapsed. Start a race!)`);
                }
            };

            // Run search once per second, indefinitely
            const searchInterval = setInterval(continuousSearch, 1000);

            // Initial race detection
            setTimeout(() => {
                this.log('[Clean API] Checking if race already started...');
                if (detectRaceStart()) {
                    this._debugWindowContents();
                }
            }, 2000);

            // Poll for car state updates (10x per second)
            let lastUpdate = 0;
            const pollCarState = (timestamp) => {
                if (timestamp - lastUpdate > 100 && window.__TS_PML_VISUAL_CAR__) {
                    lastUpdate = timestamp;

                    try {
                        const car = window.__TS_PML_VISUAL_CAR__;

                        if (typeof car.getSpeedKmh === 'function') {
                            const speed = car.getSpeedKmh();

                            if (speed !== undefined && speed !== null) {
                                if (!inRace && (speed > 0 || window.__TS_PML_CAR_STATE__?.position)) {
                                    inRace = true;
                                    this.log('[Clean API] ✓ Race active - car moving!');
                                }

                                window.__TS_PML_CAR_STATE__ = {
                                    speedKmh: speed,
                                    position: typeof car.getPosition === 'function' ? car.getPosition() : { x: 0, y: 0, z: 0 }
                                };
                            }
                        }
                    } catch (e) {
                        // Silently fail
                    }
                }

                requestAnimationFrame(pollCarState);
            };
            requestAnimationFrame(pollCarState);

            // Create PlayerAPI
            this.player = {
                getSpeed: () => {
                    try {
                        if (window.__TS_PML_VISUAL_CAR__ && typeof window.__TS_PML_VISUAL_CAR__.getSpeedKmh === 'function') {
                            return window.__TS_PML_VISUAL_CAR__.getSpeedKmh() || 0;
                        }
                        if (window.__TS_PML_CAR_STATE__) {
                            return window.__TS_PML_CAR_STATE__.speedKmh || 0;
                        }
                    } catch (e) {
                        // Silently fail
                    }
                    return 0;
                },
                setSpeed: (speed) => {
                    try {
                        if (window.__TS_PML_VISUAL_CAR__ && typeof window.__TS_PML_VISUAL_CAR__.setCarState === 'function') {
                            const currentState = window.__TS_PML_CAR_STATE__ || {
                                speedKmh: speed,
                                position: { x: 0, y: 0, z: 0 },
                                frames: 0,
                                hasStarted: false,
                                nextCheckpointIndex: 0,
                                hasCheckpointToRespawnAt: false
                            };

                            currentState.speedKmh = speed;
                            window.__TS_PML_CAR_STATE__ = currentState;
                            window.__TS_PML_VISUAL_CAR__.setCarState(currentState, false);

                            this.log(`[PlayerAPI] Set speed to ${speed} km/h`);
                            return true;
                        }
                    } catch (e) {
                        console.error('[PlayerAPI] Error setting speed:', e);
                    }
                    return false;
                },
                getPosition: () => {
                    try {
                        if (window.__TS_PML_VISUAL_CAR__ && typeof window.__TS_PML_VISUAL_CAR__.getPosition === 'function') {
                            const pos = window.__TS_PML_VISUAL_CAR__.getPosition();
                            return { x: pos.x, y: pos.y, z: pos.z };
                        }
                        if (window.__TS_PML_CAR_STATE__ && window.__TS_PML_CAR_STATE__.position) {
                            const pos = window.__TS_PML_CAR_STATE__.position;
                            return { x: pos.x, y: pos.y, z: pos.z };
                        }
                    } catch (e) {
                        // Silently fail
                    }
                    return { x: 0, y: 0, z: 0 };
                },
                setPosition: (pos) => {
                    try {
                        if (window.__TS_PML_VISUAL_CAR__ && typeof window.__TS_PML_VISUAL_CAR__.setCarState === 'function') {
                            const currentState = window.__TS_PML_CAR_STATE__ || {
                                speedKmh: 0,
                                position: pos,
                                frames: 0,
                                hasStarted: false
                            };

                            currentState.position = pos;
                            window.__TS_PML_CAR_STATE__ = currentState;
                            window.__TS_PML_VISUAL_CAR__.setCarState(currentState, false);

                            this.log(`[PlayerAPI] Set position to (${pos.x}, ${pos.y}, ${pos.z})`);
                            return true;
                        }
                    } catch (e) {
                        console.error('[PlayerAPI] Error setting position:', e);
                    }
                    return false;
                },
                teleport: (x, y, z) => {
                    return this.player.setPosition({ x, y, z });
                }
            };

            // Store for cleanup
            this._cleanAPISearchInterval = searchInterval;
            this._cleanAPIDOMObserver = domObserver;

            this._cleanAPIInitialized = true;
            this.log('Clean API initialized with race detection hooks!');
        }

        /**
         * Phase 1: Quick targeted search
         */
        _quickTargetedSearch() {
            try {
                const likelyLocations = ['game', 'Game', 'app', 'App', 'scene', 'Scene', 'world', 'World', 'state', 'State'];

                for (const key of likelyLocations) {
                    const location = window[key];
                    if (!location) continue;

                    // Check direct properties
                    for (const val of Object.values(location)) {
                        if (this._isCarObject(val)) {
                            this.log(`[Clean API] ✓ Found car in window.${key} (Phase 1)!`);
                            window.__TS_PML_VISUAL_CAR__ = val;
                            return true;
                        }
                    }
                }
            } catch (e) {
                // Silently fail
            }
            return false;
        }

        /**
         * Phase 2: Broader property search
         */
        _broaderPropertySearch() {
            try {
                // Check all enumerable properties of window (except known safe ones)
                const skipKeys = ['document', 'window', 'localStorage', 'sessionStorage', 'location', 'history', 'navigator', 'console', '__TS_PML', 'polyModLoader', 'ActivePolyModLoader'];

                for (const key in window) {
                    if (skipKeys.includes(key)) continue;

                    try {
                        const val = window[key];
                        if (val && typeof val === 'object' && this._isCarObject(val)) {
                            this.log(`[Clean API] ✓ Found car in window.${key} (Phase 2)!`);
                            window.__TS_PML_VISUAL_CAR__ = val;
                            return true;
                        }
                    } catch (e) {
                        // Skip properties we can't access
                    }
                }
            } catch (e) {
                // Silently fail
            }
            return false;
        }

        /**
         * Phase 3: Deep search with safeguards
         */
        _deepSearchWithSafeguards() {
            try {
                // Only search a few deep objects, with strict limits
                const candidates = [];

                // Collect candidates from window properties
                for (const key in window) {
                    if (['document', 'location', 'navigator', 'console'].includes(key)) continue;
                    try {
                        const val = window[key];
                        if (val && typeof val === 'object' && Object.keys(val).length < 100) {
                            candidates.push(val);
                        }
                    } catch (e) {}
                }

                // Search one level deep in candidates
                for (const obj of candidates) {
                    if (!obj || typeof obj !== 'object') continue;

                    for (const val of Object.values(obj)) {
                        if (val && typeof val === 'object' && this._isCarObject(val)) {
                            this.log('[Clean API] ✓ Found car in deep search (Phase 3)!');
                            window.__TS_PML_VISUAL_CAR__ = val;
                            return true;
                        }
                    }
                }
            } catch (e) {
                // Silently fail
            }
            return false;
        }

        /**
         * Check if object is a car
         */
        _isCarObject(obj) {
            if (!obj || typeof obj !== 'object') return false;

            // Primary check: has both methods
            if (typeof obj.setCarState === 'function' && typeof obj.getSpeedKmh === 'function') {
                return true;
            }

            // Secondary check: has speed-related methods
            if (typeof obj.getSpeedKmh === 'function') {
                return true;
            }

            return false;
        }

        /**
         * Enhanced initMods that also initializes clean API
         */
        initModsWithCleanAPI() {
            this._initCleanAPI();
            this.initMods();
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

    exports.ActivePolyModLoader = ActivePolyModLoader;

    return exports;

})({});

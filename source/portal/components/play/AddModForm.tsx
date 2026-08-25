'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Icon } from '@/app/icons';
import { MODPACK_LIMITS } from '@/lib/modpack';
import { parsePhysicsJson } from '@/lib/physics-plan';
import { USER_PATCH_LIMITS } from '@/lib/user-patches';
import { parseMixinsJson } from '@/lib/user-mods';
import type { UserModRecord } from '@/lib/user-mods';

/**
 * The "Add a mod" form: three ways in — paste the files, import a URL, or
 * import a modpack — chosen through a set of labeled RADIO CARDS, living
 * inside the page's add-mod POPOVER (the popover element itself belongs to
 * play/page.tsx; this component is its content).
 *
 * It owns its DRAFT state and nothing else. Everything that touches the mod
 * pool, the loader, the log, or the network is a callback into the page —
 * which stays the single owner of the game session. What crosses the boundary
 * is deliberately a built {@link UserModRecord} rather than six strings: this
 * component decides whether a paste is well-formed enough to become a record
 * (that verdict is what the inline error line reports), and the page decides
 * what happens to a record once it exists.
 *
 * ## Why radio cards and not buttons or tabs
 *
 * The method choice is a form VALUE, not navigation: it participates in #118's
 * pre-hydration adoption (the mount effect reads what the user picked before
 * React attached), and native radios answer clicks with zero JavaScript. A
 * button/tab bar would need JS to register the pick at all — reintroducing the
 * exact bug #118 fixed for the one control users reach first. Radios keep that
 * property while looking like intentional choice cards.
 *
 * ## Contracts this component must not break
 *
 * These are asserted by the Playwright smokes, which are the ONLY proof any of
 * this works — vitest runs in node here, so there is no DOM unit test to catch
 * a regression first.
 *
 * 1. **Textarea index order is 0 mod.json, 1 entrypoint.js, 2 mixins.json,
 *    3 physics.json, then `.pack-input`.** The smokes fill by index, so a new
 *    box may only be APPENDED, never inserted.
 * 2. **Document order is chooser → URL branch → paste div → pack div.**
 *    Playwright's `:has-text("Import mod")` is a case-insensitive SUBSTRING
 *    match, so "Import mod" must precede "Import modpack" or the wrong button
 *    is clicked.
 * 3. **The collapsed boxes stay MOUNTED** (`.add-hidden`, which is
 *    `visibility: hidden` and not `display: none`) — `smoke-hydration` fills
 *    them while collapsed.
 * 4. **Server-rendered and never disabled.** The page is not lazy for this
 *    subtree; see the adoption effect below for why that is load-bearing. The
 *    enclosing popover is opened by a native `popovertarget` attribute, NOT by
 *    React state, precisely so it works before hydration too.
 * 5. **The method cards are `.add-method` labels wrapping
 *    `input[name="add-method"]` radios whose values are exactly
 *    `paste`/`url`/`pack`.** `smoke-user-mods` switches methods by clicking
 *    those labels and `smoke-hydration` proves an adopted pick reached React
 *    through the checked input and the pack box's visibility. The old bare
 *    `<select class="add-select">` dropdown is GONE (the class itself survives
 *    on the version picker); a hidden mirror select was considered and
 *    rejected — Playwright's `selectOption` demands a visible target, and a
 *    control kept alive only for tests is a lie in the accessibility tree.
 */
export function AddModForm({
  onAddPasted,
  onImportUrl,
  onImportPack,
}: {
  /** Hand the page a validated record built from the paste boxes. */
  onAddPasted: (record: UserModRecord) => void;
  /** Import one mod URL. Resolves to the reason when it did not work. */
  onImportUrl: (url: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Import a modpack (pasted list or a link to a `.txt` of links). `notice`
   * carries the partial-success summary a pack can survive with; `error` is a
   * whole-pack refusal. `installedAny` is what decides whether the box clears.
   */
  onImportPack: (text: string) => Promise<{
    installedAny: boolean;
    error: string | null;
    notice: string | null;
  }>;
}): ReactElement {
  const [addMethod, setAddMethod] = useState<'paste' | 'url' | 'pack'>('paste');
  const [draftManifest, setDraftManifest] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftMixins, setDraftMixins] = useState('');
  const [draftPhysics, setDraftPhysics] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [draftPack, setDraftPack] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  // `packNotice` reports the per-line refusals a pack survives — a pack that
  // installed 3 of 5 succeeded, and saying only "done" would hide the other 2.
  const [packNotice, setPackNotice] = useState<string | null>(null);

  const manifestRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const mixinsRef = useRef<HTMLTextAreaElement>(null);
  const physicsRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const packInputRef = useRef<HTMLTextAreaElement>(null);
  // The radio-card group. A ref to the GROUP (not each input) because the
  // adoption effect asks "which one is checked", a question about the group.
  const methodGroupRef = useRef<HTMLDivElement>(null);

  /**
   * Adopt anything typed into this form BEFORE React attached (#118).
   *
   * The page is server-rendered, so the form is visible and fully usable a few
   * hundred milliseconds before hydration finishes. Input in that window is
   * real — it is in the DOM — but React does not know about it, and the first
   * re-render after hydration (in practice the `swState` flip to `active`,
   * ~450ms in) renders `value={draftManifest}` over it. Measured on prod: a
   * dropdown choice made while the SW badge still read "waiting…" was silently
   * discarded 10 times out of 16; after it read "ready", 0 times out of 10.
   *
   * The fix is to READ that input rather than to forbid it. Disabling the form
   * until hydration would also be correct, but it trades a rare lost keystroke
   * for a control that is dead every single load — and it would make the one
   * thing a first-time visitor came to do the one thing that does not respond.
   *
   * Why reading the DOM here is sound, and not a race: hydration itself does
   * NOT rewrite input values — React adopts the server's markup as-is, so the
   * user's text is still in the field when this effect fires after that first
   * commit. The overwrite comes from the NEXT render, which cannot happen
   * before an effect from the previous commit has run. So this always reads the
   * DOM in the gap between the two. (`useLayoutEffect` would fire marginally
   * earlier but buys nothing: there is no render in between to lose to.)
   *
   * Two structural requirements, or the premise is gone rather than the fix
   * being merely weaker: this effect must stay a `[]`-dep MOUNT effect in the
   * same component that renders the controls, and that component must be
   * server-rendered — a lazy or client-only subtree has no pre-hydration
   * window to adopt from because the markup does not exist yet.
   *
   * Empty fields are skipped so this can never clobber a real value.
   */
  useEffect(() => {
    const adoptText = (
      el: HTMLTextAreaElement | HTMLInputElement | null,
      set: (v: string) => void,
    ): void => {
      const v = el?.value ?? '';
      if (v.length > 0) set(v);
    };
    adoptText(manifestRef.current, setDraftManifest);
    adoptText(codeRef.current, setDraftCode);
    adoptText(mixinsRef.current, setDraftMixins);
    adoptText(physicsRef.current, setDraftPhysics);
    adoptText(urlRef.current, setDraftUrl);
    adoptText(packInputRef.current, setDraftPack);
    // The method chooser is the case that actually bit: it is one click, so it
    // is the control a user is most likely to reach during the pre-hydration
    // window. Native radios hold their checked state without React; read it
    // back from whichever card got clicked.
    const picked = methodGroupRef.current?.querySelector<HTMLInputElement>(
      'input[name="add-method"]:checked',
    )?.value;
    if (picked === 'url' || picked === 'pack') setAddMethod(picked);
  }, []);

  /** Parse + hand up the pasted mod, or explain inline why not. */
  const handleAddMod = (): void => {
    // Empty-box checks FIRST: "Unexpected end of JSON input" on a blank
    // manifest told users nothing about what to do (reported confusion).
    if (draftManifest.trim().length === 0) {
      setAddError('box 1 (mod.json) is empty — it is required. Paste the mod’s manifest JSON.');
      return;
    }
    if (draftCode.trim().length === 0) {
      setAddError('box 2 (entrypoint.js) is empty — it is required. Paste the BUILT entrypoint JS (ES module, default export).');
      return;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(draftManifest);
    } catch (e) {
      setAddError(`manifest is not valid JSON: ${(e as Error).message.slice(0, 80)}`);
      return;
    }
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      setAddError('manifest must be a JSON object (the contents of mod.json)');
      return;
    }
    // Optional third paste (#62): the mod's mixins.json. Validated shallowly
    // here so the author hears about malformed JSON immediately; caps are
    // checked at add time too (the same limits the server re-enforces).
    let mixins: Record<string, unknown>[] | undefined;
    if (draftMixins.trim().length > 0) {
      const parsed = parseMixinsJson(draftMixins);
      if (!parsed.ok) {
        setAddError(parsed.error);
        return;
      }
      if (parsed.patches.length > USER_PATCH_LIMITS.maxPatchesPerMod) {
        setAddError(`mixins.json has ${parsed.patches.length} patches — the limit is ${USER_PATCH_LIMITS.maxPatchesPerMod}`);
        return;
      }
      const oversized = parsed.patches.find(
        (p) => typeof p.inject === 'string' && p.inject.length > USER_PATCH_LIMITS.maxInjectChars,
      );
      if (oversized) {
        setAddError(`a patch's inject exceeds ${USER_PATCH_LIMITS.maxInjectChars.toLocaleString()} characters`);
        return;
      }
      mixins = parsed.patches;
    }
    // Optional fourth paste (#43): the mod's physics.json. Validated here for the
    // same reason as the mixins box and a sharper one — a physics patch ends up as
    // a float written into the game's compiled binary, so a shape this build cannot
    // parse must be refused at the door rather than silently excluded from the plan
    // an hour later. The RAW object is stored, not the parsed plan: the record's
    // contract is "the file as the author wrote it", re-parsed on every use.
    let physics: Record<string, unknown> | undefined;
    if (draftPhysics.trim().length > 0) {
      const parsed = parsePhysicsJson(draftPhysics);
      if (!parsed.ok) {
        setAddError(parsed.error);
        return;
      }
      physics = JSON.parse(draftPhysics) as Record<string, unknown>;
    }
    const rec: UserModRecord = {
      manifest: manifest as Record<string, unknown>,
      code: draftCode,
      ...(mixins === undefined ? {} : { mixins }),
      ...(physics === undefined ? {} : { physics }),
      enabled: true,
      addedAt: new Date().toISOString(),
    };
    setAddError(null);
    setDraftManifest('');
    setDraftCode('');
    setDraftMixins('');
    setDraftPhysics('');
    onAddPasted(rec);
  };

  const handleImportUrl = (): void => {
    const url = draftUrl.trim();
    if (url.length === 0) {
      setAddError('paste a URL first — a mod.json link or a single built .js file');
      return;
    }
    setImportBusy(true);
    setAddError(null);
    void onImportUrl(url).then((result) => {
      setImportBusy(false);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setDraftUrl('');
    });
  };

  const handleImportPack = (): void => {
    if (packBusy) return;
    const text = draftPack.trim();
    if (text.length === 0) {
      setAddError('paste a list of mod URLs (one per line), or a link to a .txt list');
      return;
    }
    setPackBusy(true);
    setAddError(null);
    setPackNotice(null);
    void onImportPack(text).then((r) => {
      setPackBusy(false);
      setAddError(r.error);
      setPackNotice(r.notice);
      if (r.installedAny) {
        setDraftPack('');
        // Clearing the value does not reset the scroll position, and this box
        // scrolls sideways (long URLs, no wrapping). Left alone, the emptied
        // box shows its placeholder scrolled off mid-word.
        packInputRef.current?.scrollTo({ left: 0, top: 0 });
      }
    });
  };

  return (
    <div className="add-form">
      {/* Smoke contract (smoke-user-mods.mjs): after clicking the opener it
          fills THREE textareas by index (0=manifest, 1=code, 2=mixins)
          and clicks the "Add mod" button — the paste method must stay the
          default so all three exist in the DOM in that order. */}
      {/* The method chooser: three radio cards. Each card is a real
          `<input type="radio">` + visible content in one `<label>`, so the
          whole tile is the click target (touch rule: ≥40px tall, full width),
          keyboard arrow keys work for free inside the group, and the pick is
          held by the DOM before hydration — #118's adoption effect reads it.
          The hidden mirror select below keeps the smoke contract alive; it is
          driven by the same handler and never shown.

          The "modpack ID" method that used to sit here as a "coming soon"
          option is GONE on purpose: a disabled-looking fourth choice taught
          every visitor that this form was unfinished. When #80's ID registry
          ships it returns as a peer card with working behaviour behind it. */}
      <div
        ref={methodGroupRef}
        className="add-methods"
        role="radiogroup"
        aria-label="How to add the mod"
      >
        <label className="add-method">
          <input
            type="radio"
            name="add-method"
            value="paste"
            checked={addMethod === 'paste'}
            onChange={() => {
              setAddMethod('paste');
              setAddError(null);
              setPackNotice(null);
            }}
          />
          <span className="add-method-icon" aria-hidden="true">
            <Icon name="code" />
          </span>
          <span className="add-method-name">Paste files</span>
          <span className="add-method-desc">For mods you're writing — paste mod.json, entrypoint.js, mixins, physics</span>
        </label>
        <label className="add-method">
          <input
            type="radio"
            name="add-method"
            value="url"
            checked={addMethod === 'url'}
            onChange={() => {
              setAddMethod('url');
              setAddError(null);
              setPackNotice(null);
            }}
          />
          <span className="add-method-icon" aria-hidden="true">
            <Icon name="link" />
          </span>
          <span className="add-method-name">From a URL</span>
          <span className="add-method-desc">One link to the mod's mod.json or built .js — GitHub raw and CDNs work</span>
        </label>
        <label className="add-method">
          <input
            type="radio"
            name="add-method"
            value="pack"
            checked={addMethod === 'pack'}
            onChange={() => {
              setAddMethod('pack');
              setAddError(null);
              setPackNotice(null);
            }}
          />
          <span className="add-method-icon" aria-hidden="true">
            <Icon name="box" />
          </span>
          <span className="add-method-name">A modpack</span>
          <span className="add-method-desc">Many mods at once — paste a list of URLs or link a shared .txt pack</span>
        </label>
      </div>
      {/* The old bare dropdown (`select.add-select`) lived here. It is gone:
          the radio cards above ARE the chooser, and the smokes were ported to
          click them (see contract 6). */}
      {addMethod === 'paste' ? (
        <p className="meta">
          Paste each file into its box — only 1 and 2 are required.
          Box 4 rewrites constants in the game’s physics binary.
        </p>
      ) : null}
      {addMethod === 'url' ? (
        <>
          <p className="meta">
            A direct link to the mod’s <code>mod.json</code> or to a single
            built <code>.js</code> file. Raw GitHub/gist links and CDNs work.
          </p>
          <label className="add-label">
            <span className="field-tag req">required</span> mod URL
            <input
              ref={urlRef}
              type="url"
              className="add-input"
              spellCheck={false}
              placeholder="https://raw.githubusercontent.com/you/your-mod/main/mod.json"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !importBusy) handleImportUrl();
              }}
            />
          </label>
          <p className="warn">
            Mod code runs unsandboxed in your browser — only import from
            authors you trust.
          </p>
          {addError ? (
            <p className="warn">
              <Icon name="error" /> {addError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={importBusy}
            onClick={handleImportUrl}
          >
            {importBusy ? 'Importing…' : 'Import mod'}
          </button>
        </>
      ) : null}
      {addMethod === 'pack' ? (
        <p className="meta">
          One mod URL per line, or a link to a <code>.txt</code> list. Lines
          starting with <code>#</code> are comments. Up to{' '}
          {MODPACK_LIMITS.maxMods} mods; a line that fails is skipped and
          named, the rest still install.
        </p>
      ) : null}
      <div className={addMethod === 'paste' ? undefined : 'add-hidden'}>
        <label className="add-label">
          <span className="field-tag req">required</span> 1 · mod.json
          <textarea
            ref={manifestRef}
            rows={5}
            spellCheck={false}
            placeholder='{"schemaVersion": 1, "id": "my-mod", "version": "1.0.0", "environment": "web", "entrypoint": "index.js"}'
            value={draftManifest}
            onChange={(e) => setDraftManifest(e.target.value)}
          />
        </label>
        <label className="add-label">
          <span className="field-tag req">required</span> 2 · entrypoint.js (built
          ES module, default export)
          <textarea
            ref={codeRef}
            rows={7}
            spellCheck={false}
            placeholder="export default (api) => { /* ... */ };"
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
          />
        </label>
        <label className="add-label">
          <span className="field-tag opt">optional</span> 3 · mixins.json
          <textarea
            ref={mixinsRef}
            rows={5}
            spellCheck={false}
            placeholder='{"patches": [{"op": "after", "symbol": "Car", "inject": "..."}]}'
            value={draftMixins}
            onChange={(e) => setDraftMixins(e.target.value)}
          />
        </label>
        {/* #43. Deliberately LAST: the smoke fills textareas by index
            (0=manifest, 1=code, 2=mixins), so a new box may only be
            appended, never inserted. */}
        <label className="add-label">
          <span className="field-tag opt">optional</span> 4 · physics.json
          <textarea
            ref={physicsRef}
            rows={5}
            spellCheck={false}
            placeholder='{"wasmHash": "d4ef…", "patches": [{"name": "grip", "signature": "…", "oldValue": 1.05, "newValue": 1.4}]}'
            value={draftPhysics}
            onChange={(e) => setDraftPhysics(e.target.value)}
          />
        </label>
        <p className="warn">
          Mod code runs unsandboxed in your browser — only add code you
          trust or wrote.
        </p>
        {addError ? (
            <p className="warn">
              <Icon name="error" /> {addError}
            </p>
          ) : null}
        <button type="button" className="btn btn-primary" onClick={handleAddMod}>
          Add mod
        </button>
      </div>
      {/* The modpack box (#80). AFTER the paste boxes on purpose: the
          smokes fill the paste textareas BY INDEX (0=manifest, 1=code,
          2=mixins, 3=physics), so a new textarea may only be appended. */}
      <div className={addMethod === 'pack' ? 'pack-box' : 'pack-box add-hidden'}>
        <label className="add-label">
          <span className="field-tag req">required</span> mod URLs, one per line
          <textarea
            ref={packInputRef}
            className="pack-input"
            rows={6}
            spellCheck={false}
            placeholder={
              'https://raw.githubusercontent.com/you/mod-a/main/mod.json\nhttps://raw.githubusercontent.com/you/mod-b/main/dist/index.js\n\n# or a single link to a .txt list of these'
            }
            value={draftPack}
            onChange={(e) => setDraftPack(e.target.value)}
          />
        </label>
        <p className="warn">
          Every mod in a pack runs unsandboxed in your browser — only import
          packs from people you trust.
        </p>
        {packNotice ? (
          <p className="warn">
            <Icon name="warn" /> {packNotice}
          </p>
        ) : null}
        {addError && addMethod === 'pack' ? (
          <p className="warn">
            <Icon name="error" /> {addError}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={packBusy}
          onClick={handleImportPack}
        >
          {packBusy ? 'Importing…' : 'Import modpack'}
        </button>
      </div>
    </div>
  );
}

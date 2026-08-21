# Safety & fairness

> **Locked decision: warn-only.** TSPML labels physics/multiplayer mods and discloses the risks; it does **not** hard-block uploads. Two things this doc is deliberately honest about: (1) the JS shared realm cannot truly *enforce* a sandbox, and (2) client-side fairness gates are best-effort against honest users, not against adversaries.

## Capability model — consented-advisory (honest)

Mods declare `capabilities` in `mod.json` (e.g. `["dom","storage","network","physics","multiplayer"]`). The loader surfaces these as a **load-time consent prompt** and hands the mod an `api` object scoped to declared capabilities. Raw `window`/`eval` access requires an explicit **`unsafe`** capability + user consent.

**Honest scope (review correction):** in a same-realm ES-module page, a mod can always reach `globalThis.window.fetch(...)` or `globalThis.eval(...)` regardless of the `api` object handed to it — JS has no ambient-authority isolation without **SES lockdown + a membrane** (or a separate realm). So TSPML's capability declarations are **consented-advisory**, not "enforced." If true isolation becomes a requirement, the path is SES lockdown + a membrane proxy, with the mixin escape-hatch gated behind explicit `unsafe` consent. We will not ship an "enforced" claim the platform cannot back.

## Fairness — warn-only classification

Every mod is classified:
- **Cosmetic/local** (skins, UI, audio, local-only visuals) — always fine.
- **Physics-affecting** (touches the sim worker / car state) — flagged.
- **Multiplayer-affecting** — flagged + capability-gated.

Per the locked **warn-only** decision, TSPML **labels** these and **discloses risk**; it does **not** disable leaderboard uploads. Users may upload at their own risk.

**Ban-risk disclosure (must be prominent):** PolyTrack's leaderboards validate deterministic input replays, and a server-side anti-cheat is "in development." A physics/speed mod can trivially break replay validity, and once anti-cheat ships, uploading such runs risks **account bans from leaderboards.** Docs, the mod panel, and the publish flow state this plainly. (If the project later tightens to strict quarantine, the classification machinery already exists — only the gating policy changes.)

### The game notices (measured, #43)

Worth recording because it was verified rather than assumed. With the WASM patcher live, three runs were driven through the portal against the same server and the same headless browser:

| Run | Physics plan | Game's determinism check |
| --- | --- | --- |
| no mod installed | none | passes |
| mod installed, plan pinned to another build | **refused** (vanilla bytes served) | passes |
| mod installed, plan applied | **1 constant rewritten** | **fails** — "Some leaderboard features are disabled" |

The middle row is what makes this evidence rather than a coincidence: the same mod is installed and the same code runs, and the only difference is whether the constant was actually written. So PolyTrack detects the rewritten physics on its own and disables the affected leaderboard features itself, without TSPML telling it anything.

This does not change the warn-only stance, and it is not a substitute for one. It does mean the honest thing to tell a player is not merely "this might be a problem later" but "the game already responded to this, in this session." The portal's physics panel says the session's lap times are not vanilla for exactly this reason.

### Risk over a set is a maximum

A player runs a set of mods, not one mod, but the portal has a single safety line. The rule is that the line reports the whole enabled set: `leaderboardRisk` is `warn` if **any** mod warns, `vanillaSafe` is true only if **every** mod is, and the capabilities and warnings shown are the unions.

This is deliberately not a sample. Reading one mod's report — the first, say — hides a physics mod that happens to have been added second, which is precisely the case the label exists for. And an empty set is reported as *no set*, not as a clean one: "no mods" and "mods, all fine" are different facts, and rendering the second for the first strands a stale safety line on screen after the last mod is removed.

The wording separates the mod's own admission from TSPML's conclusion. A mod that declares `vanillaSafe: false` reads "not vanilla-safe"; a mod that declares itself safe but carries a physics patch or the network capability reads "leaderboard risk". Both are warn-only.

## Determinism lint (warnings)

Physics-context mods (worker environment, or subscribing to `physics.preStep/postStep`) are **statically linted** for non-deterministic APIs (`Date.now`, `Math.random`, `performance.now`, `crypto.getRandomValues`, `fetch`). Under warn-only these are **warnings** (not blocks), surfaced to the modder at authoring time and flagged on the mod's profile. A **seeded deterministic RNG** primitive is provided for mods that need randomness without breaking replays.

## Why warn-only is honest about its limits

Client-side quarantine on an untrusted client cannot stop a determined cheater from hiding physics tampering and uploading anyway. Warn-only is a ** UX + disclosure** stance, not an anti-cheat. The real defense (server-side replay validation) is outside TSPML's control. Roadmap option: offer the registry/signing infrastructure as a **signal the server can use** (mod content-hash allowlisting) rather than a client gate — a partnership posture, not an arms race.

## Legal / ToS posture

- **Ship only** loader + mappings + mod code; **never** the game bundle.
- The portal fetches the user's **live** game copy via the proxy; the **proxy forwards Origin/Referer** to the official desktop origin for leaderboard/multiplayer endpoints, because those endpoints expect the game's own desktop client. This is an acknowledged **ToS gray area** — origin-forwarding + running a modified copy can violate "no derivative works / no client modification" clauses even with zero redistribution.
- **Do not rely** on "other rightsholders tolerate mapping projects" as legal cover; those precedents involve different rightsholders who took their own positions, and Kodub has stated none. The mappings file is reverse-engineered information about copyrighted code (arguably a derivative work), and the seed (`cwcinc`) is a no-license third-party dump — so the canonical map must be **regenerated from the live bundle**, not copied from the seed.
- **Takedown-compliance plan:** on any Kodub request, pull the registry entry, withdraw the affected map, and cooperate. Position TSPML as a fan tool that **protects** leaderboards (warn-only labels, no Origin spoof *in the loader* — origin handling is confined to the proxy path and documented).
- **First map provenance:** produce it from an auto-pipeline run against the live bundle (M1+), not from the no-license `cwcinc` dump.

## Open posture items (to resolve before a public launch)

- Seek/confirm Kodub's position on mapping redistribution + client modification (even implicitly, via the modding Discord).
- Decide whether to offer the registry as a server-side allowlist signal.
- Keep the warn-only policy under review as anti-cheat matures.

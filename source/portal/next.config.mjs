/**
 * Minimal Next.js config for the TSPML portal (milestone M2).
 *
 * The game loads entirely through the service worker + /api/proxy route; no
 * build-time transforms happen here yet. The /api/proxy route strips the
 * upstream CSP/X-Frame-Options so the portal can iframe the proxied document.
 *
 * Future: if the physics WASM ever needs SharedArrayBuffer (threaded ammo.js),
 * add Cross-Origin-Opener-Policy: same-origin + Cross-Origin-Embedder-Policy:
 * require-corp via `headers()` here. PolyTrack's physics worker is postMessage
 * based today, so this is not required for the M2 proof of concept.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

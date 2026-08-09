/**
 * TSPML sample URL mod — the smallest real mod: logs on load, notes each
 * race.started, cleans up via the returned disposer (the loader's factory
 * form: default(api) does its work and may return a cleanup function).
 * Served from the portal's own /sample-mod/ so "Import from a URL" has a
 * known-good target (…/sample-mod/mod.json).
 */
export default (api) => {
  api.logger.info('[tspml-sample-url-mod] loaded via URL import');
  const off = api.events.on('race.started', () => {
    api.logger.info('[tspml-sample-url-mod] race started');
  });
  return () => off();
};

/**
 * TSPML sample pack mod — the second half of the portal's own sample modpack
 * (/sample-pack.txt). Deliberately as small as the first: what a modpack test
 * needs to prove is that BOTH lines installed, not that either mod does
 * anything interesting.
 */
export default (api) => {
  api.logger.info('[tspml-sample-pack-mod] loaded via modpack import');
  const off = api.events.on('race.started', () => {
    api.logger.info('[tspml-sample-pack-mod] race started');
  });
  return () => off();
};

// Whiteout: the physics engine. Rapier (WASM) from a CDN, one pinned version, loaded only when a game starts
// so the menu never waits for it.
const RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';
let loading = null;

export function loadPhysics() {
  if (!loading) {
    loading = import(RAPIER_URL)
      .then(async m => { const R = m.default || m; await R.init(); return R; })
      .catch(e => { loading = null; throw e; });
  }
  return loading;
}

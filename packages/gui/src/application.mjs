// The hyper application of the GUI (docs/plans/fsm-v1/plan.md, C-7), shared by the server and the tests: the manifest, the built
// templates and the handlers, with the store and the assets bound by the caller.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from '@polyspec/hyper-server';
import { handlers } from './handlers.mjs';

/** The directory of the package packages/gui. */
export const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The application of the GUI with `store` as its store and the result of `assets()` as its assets. The build must have written the templates. */
export async function openApplication(store, assets) {
  const app = await App.open({
    manifest: path.join(GUI, 'app', 'app.json'),
    templates: { index: path.join(GUI, 'build', 'templates.index.json'), root: path.join(GUI, 'public') },
    handlers,
    timezone: 'UTC',
  });
  app.bind('store', () => store);
  app.bind('assets', assets);
  return app;
}

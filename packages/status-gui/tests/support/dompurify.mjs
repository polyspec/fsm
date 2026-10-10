// Node has no DOM, and mermaid sanitizes its label text with DOMPurify, which then fails on its first call (`addHook`). This
// module makes the import of 'dompurify' by mermaid resolve to dompurify-stub.mjs, so that mermaid parses in Node. The stub is
// used for parsing only: the sanitizing of label text is not part of the state structure that the tests check.
import { registerHooks } from 'node:module';

const STUB = new URL('./dompurify-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'dompurify') return { url: STUB, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Stub of the DOMPurify module for Node, used only by the Mermaid parse test (tests/support/dompurify.mjs). Mermaid calls
// DOMPurify.addHook and DOMPurify.sanitize while it parses; the real module has no DOM to work on in Node and does not
// define addHook there. The stub answers those calls and passes the text through, which affects label text only.
const DOMPurify = {
  isSupported: false,
  addHook() {},
  removeHook() {},
  removeHooks() {},
  removeAllHooks() {},
  sanitize(text) {
    return String(text);
  },
};
export default DOMPurify;

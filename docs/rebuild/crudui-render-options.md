<!-- doc-id: rebuild-crudui-render-options -->
# Rebuild: decoder of the render options of the edit form

[한국어](crudui-render-options.ko.md)

- Requirement: the form state that the edit page embeds (`packages/gui/client/form-state.ts`) decodes its render options
  (`action`, `hidden`, `formErrors`, `errors`) and refuses a value outside their types, naming the member.
- Tools searched: `@polyspec/crudui-generator-core` 0.0.5 (the installed pin before S-44-18) exports no decoder; 0.0.7
  (the pin now, released) exports the type `FormRenderOptions` and `decodeFormTemplate`, but no decoder of the render
  options; 0.0.8 adds `decodeFormRenderOptions` (crudui C14.50), and its release asset answers 404, so it is not released.
- Why it is rebuilt: no released tool decodes the render options, and the lint of client code needs a typed decoder.
  `packages/gui/client/form-state.ts` `decodeRenderOptions` checks the same members and types as the 0.0.8 decoder and
  nothing more; it refuses an unknown member with the `FormRenderOptionsError` of fsm.
- Retry: when crudui 0.0.8 is released, the pins of `packages/gui` move to it and `decodeRenderOptions` is removed.

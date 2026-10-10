// The loaders of the status GUI (docs/plans/status-v1.md, C-7): the machine list and the machine detail. The handlers read the
// store from the service 'store' and the hyper asset URL from the service 'assets', which the entry point binds. A handler
// owns no rule: the definitions come from store.load(), and the findings from core run('check'), which returns the load
// findings first. Every finding of the project is shown on every page, so a finding is never hidden (docs/spec/status.md, B-5).

import { readFileSync } from 'node:fs';
import { NotFound } from '@polyspec/hyper-server';
import { renderList } from '@polyspec/crudui-generator-html';
import { parse as parseYaml } from 'yaml';
import { run } from '../../status-compiler/src/core/run.mjs';
import { mermaidText } from '../../status-compiler/src/store-mermaid/write.mjs';

/** The crudui list declaration of the machine list (crud/machines.yml). */
const LIST_SPEC = parseYaml(readFileSync(new URL('../crud/machines.yml', import.meta.url), 'utf8'));

/** A finding as the templates show it; the machine of a finding without one is the empty text. */
const view = ({ code, machine, path: at, message }) => ({ code, machine: machine ?? '', path: at, message });

/** The definitions that the store loads, and the findings of the project: the load findings, or else the core check. */
async function project(store) {
  const loaded = await store.load();
  const checked = await run('check', store);
  return { definitions: loaded.definitions, findings: checked.findings };
}

export const handlers = {
  shared: ({ services }) => ({ assets: services.get('assets') }),

  routes: {
    'machines.list': {
      load: async ({ services }) => {
        const { definitions, findings } = await project(services.get('store'));
        const rows = definitions.map(({ machine }) => ({ machine }));
        return {
          list: renderList(LIST_SPEC, rows),
          hasFindings: findings.length > 0,
          findings: findings.map(view),
        };
      },
    },

    'machines.show': {
      load: async ({ request, services }) => {
        const machine = request.param('machine') ?? '';
        const { definitions, findings } = await project(services.get('store'));
        const definition = definitions.find(item => item.machine === machine);
        if (definition === undefined) throw new NotFound();
        // The diagram is the canonical text of the machine. A machine with a finding of its own is not written as a diagram,
        // because the canonical form of an invalid machine does not exist; its findings are shown instead.
        const withErrors = findings.some(finding => finding.machine === machine);
        return {
          machine,
          states: definition.states.map(state => ({
            key: state.key, code: state.code, initial: state.initial === true, final: state.final === true,
          })),
          events: definition.events.map(event => ({
            key: event.key, edges: event.edges.map(edge => ({ from: edge.from, to: edge.to })),
          })),
          showDiagram: !withErrors,
          mermaid: withErrors ? '' : mermaidText(definition),
          hasFindings: findings.length > 0,
          findings: findings.map(view),
        };
      },
    },
  },
};

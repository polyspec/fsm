// The loaders and actions of the fsm GUI (docs/plans/fsm-v1/plan.md, C-7): the machine list and detail, and the machine edit,
// rename, new and delete screens. The handlers read the store from the service 'store' and the hyper asset URL from the service
// 'assets', which the entry point binds. A handler owns no rule: the definitions come from store.load(), the findings of a page
// from core run('check') (which returns the load findings first), and a save or a rename from core run. Every finding of the
// project is shown on every page, so a finding is never hidden (docs/spec/fsm.md, B-5).

import { readFileSync } from 'node:fs';
import { NotFound, Result } from '@polyspec/hyper-server';
import { renderList } from '@polyspec/crudui-generator-html';
import { parse as parseYaml } from 'yaml';
import { run } from '../../compiler/src/core/run.mjs';
import { mermaidText } from '../../compiler/src/store-mermaid/write.mjs';
import {
  completeData, editData, editState, formErrorsOf, newErrorsOf, nextCodeErrors, nextCodeOf, renameData, renameErrorsOf, renderEdit, renderNew,
  renderRename, suggestCodes,
} from './forms.mjs';
import {
  definitionOf, newMachineOf, parseFormFields, renamesOf,
} from './form-data.mjs';

/** The crudui list declaration of the machine list (crud/machines.yml). */
const LIST_SPEC = parseYaml(readFileSync(new URL('../crud/machines.yml', import.meta.url), 'utf8'));

/** A finding as the templates show it; the machine of a finding without one is the empty text. */
const view = ({ code, machine, path: at, message }) => ({ code, machine: machine ?? '', path: at, message });

/** The data of the machine list of `definitions`: one row per machine. */
const listPage = definitions => ({ list: renderList(LIST_SPEC, definitions.map(({ machine }) => ({ machine }))) });

/** The definitions and the lock that the store loads, and the findings of the project: the load findings, or else the core check. */
async function project(store) {
  const loaded = await store.load();
  const checked = await run('check', store);
  return { definitions: loaded.definitions, lock: loaded.lock, findings: checked.findings };
}

/** The machine of the request, its definition and the project of the store; a machine that the store does not have is not found. */
async function projectOfMachine(request, services) {
  const machine = request.param('machine') ?? '';
  const projected = await project(services.get('store'));
  const definition = projected.definitions.find(item => item.machine === machine);
  if (definition === undefined) throw new NotFound();
  return { machine, definition, ...projected };
}

/** The machine of the request, the store and what it loads; a machine that the store does not have is not found. */
async function loadedMachine(request, services) {
  const machine = request.param('machine') ?? '';
  const store = services.get('store');
  const loaded = await store.load();
  if (!loaded.definitions.some(item => item.machine === machine)) throw new NotFound();
  return { machine, store, loaded };
}

export const handlers = {
  shared: ({ services }) => ({ assets: services.get('assets') }),

  routes: {
    'machines.rename': {
      load: async ({ request, services }) => {
        const { machine, definition, findings } = await projectOfMachine(request, services);
        return {
          machine,
          form: renderRename(machine, renameData(definition), { csrf: request.csrfToken() }),
          hasFindings: findings.length > 0,
          findings: findings.map(view),
        };
      },
      post: async ({ request, services }) => {
        const { machine, store } = await loadedMachine(request, services);
        const data = parseFormFields(request.form());
        const { renames, rows } = renamesOf(machine, data);
        const result = await run('lock', store, { renames });
        if (result.findings.length === 0) return Result.redirect(`/machines/${machine}`);
        const { errors, formErrors } = renameErrorsOf(result.findings, rows);
        return Result.invalid({
          machine,
          form: renderRename(machine, { states: data.states ?? {} }, { csrf: request.csrfToken(), errors, formErrors }),
          hasFindings: true,
          findings: result.findings.map(view),
        });
      },
    },
    'machines.edit': {
      load: async ({ request, services }) => {
        const { machine, definition, definitions, lock, findings } = await projectOfMachine(request, services);
        const data = editData(definition);
        const next = nextCodeOf(machine, definitions, lock);
        const formErrors = nextCodeErrors(next);
        return {
          machine,
          form: renderEdit(machine, data, { csrf: request.csrfToken(), formErrors }),
          state: editState(machine, data, next, { csrf: request.csrfToken(), formErrors }),
          hasFindings: findings.length > 0,
          findings: findings.map(view),
        };
      },
      post: async ({ request, services }) => {
        const { machine, store, loaded } = await loadedMachine(request, services);
        // A malformed body is a BadRequest here, before any rule runs; the rules are the core's.
        const data = parseFormFields(request.form());
        const { definition, rows } = definitionOf(machine, data);
        const suggested = suggestCodes(loaded.definitions, loaded.lock, definition);
        const definitions = loaded.definitions.map(item => (item.machine === machine ? suggested.definition : item));
        const saved = suggested.findings.length > 0
          ? { findings: suggested.findings }
          : await run('save', store, { definitions });
        if (saved.findings.length === 0) return Result.redirect(`/machines/${machine}`);
        // The form shows what was submitted, with the codes that were suggested for the new states.
        const shown = structuredClone(completeData(data));
        suggested.definition.states.forEach((state, index) => {
          if (state.code !== undefined) shown.states[rows.states[index].rk].code = String(state.code);
        });
        const { errors, formErrors: savedErrors } = formErrorsOf(saved.findings, rows);
        const next = nextCodeOf(machine, loaded.definitions, loaded.lock);
        const formErrors = [...savedErrors, ...nextCodeErrors(next)];
        return Result.invalid({
          machine,
          form: renderEdit(machine, shown, { csrf: request.csrfToken(), errors, formErrors }),
          state: editState(machine, shown, next, { csrf: request.csrfToken(), errors, formErrors }),
          hasFindings: true,
          findings: saved.findings.map(view),
        });
      },
    },

    'machines.list': {
      load: async ({ services }) => {
        const { definitions, findings } = await project(services.get('store'));
        return { ...listPage(definitions), hasFindings: findings.length > 0, findings: findings.map(view) };
      },
    },

    'machines.new': {
      load: async ({ request, services }) => {
        const { findings } = await project(services.get('store'));
        return {
          form: renderNew({}, { csrf: request.csrfToken() }),
          hasFindings: findings.length > 0,
          findings: findings.map(view),
        };
      },
      post: async ({ request, services }) => {
        const store = services.get('store');
        const loaded = await store.load();
        const { machine, state } = newMachineOf(parseFormFields(request.form()));
        const next = { machine, states: [{ key: state, initial: true, final: true }], events: [] };
        const suggested = suggestCodes(loaded.definitions, loaded.lock, next);
        const saved = suggested.findings.length > 0
          ? { findings: suggested.findings }
          : await run('save', store, { definitions: [...loaded.definitions, suggested.definition] });
        if (saved.findings.length === 0) return Result.redirect(`/machines/${machine}`);
        const { errors, formErrors } = newErrorsOf(saved.findings);
        return Result.invalid({
          form: renderNew({ machine, state }, { csrf: request.csrfToken(), errors, formErrors }),
          hasFindings: true,
          findings: saved.findings.map(view),
        });
      },
    },

    'machines.delete': {
      // A delete has no page: a GET of its path is not found, and only the POST of the detail page deletes.
      load: () => {
        throw new NotFound();
      },
      post: async ({ request, services }) => {
        const { machine, store, loaded } = await loadedMachine(request, services);
        // A delete is a save without the machine: the core moves its codes to the lock's reserved list.
        const definitions = loaded.definitions.filter(item => item.machine !== machine);
        const saved = await run('save', store, { definitions });
        if (saved.findings.length === 0) return Result.redirect('/');
        return Result.invalid({
          ...listPage(definitions),
          hasFindings: true,
          findings: saved.findings.map(view),
        });
      },
    },

    'machines.show': {
      load: async ({ request, services }) => {
        const { machine, definition, findings } = await projectOfMachine(request, services);
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

// Runs inside the page (installed with evaluateOnNewDocument), so it must stay self-contained:
// no imports, no references to module scope. Node talks to it through window.__vidimus.

export type Value = string | boolean | null;

export interface FieldInfo {
  key: string;
  name: string;
  id: string;
  tag: string;
  type: string;
  label: string;
  autocomplete: string;
  usable: boolean;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  pattern?: string;
  accept?: string;
  multiple: boolean;
  options: { value: string; disabled: boolean }[];
  custom: string[];
  inferred?: string[];
}

export interface FormInfo {
  index: number;
  kind: 'form' | 'group';
  id: string;
  name: string;
  method: string;
  action: string;
  ordinal: number | null;
  novalidate: boolean;
  submitter: string;
  adapters: string[];
  fields: FieldInfo[];
  hidden: string[];
}

export type Layer = 'valid' | 'invalid' | 'n/a';

export interface FieldState {
  value?: string;
  native: Layer;
  flags: string[];
  framework: Layer;
  ui: Layer;
  ariaInvalid: boolean;
  messages: string[];
}

export interface PageEvents {
  submits: { index: number; prevented: boolean }[];
  invalid: string[];
  errors: string[];
  sockets: string[];
  opened: string[];
  workers: string[];
  canary: boolean;
}

interface Probe {
  forms(): FormInfo[];
  fill(index: number, values: Record<string, Value>, target: string | null): string;
  focus(index: number, key: string): void;
  blur(index: number, key: string): void;
  element(index: number, key: string): Element | null;
  root(index: number): Element;
  observe(index: number): Record<string, FieldState>;
  submit(index: number, times: number): boolean;
  drain(): PageEvents;
}

declare global {
  interface Window {
    __vidimus: Probe;
  }
}

// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const probe = (skip: string[]) => {
  const events: PageEvents = {
    submits: [],
    invalid: [],
    errors: [],
    sockets: [],
    opened: [],
    workers: [],
    canary: false,
  };
  const CONTROLS = 'input, select, textarea';
  const SKIPPED_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image']);
  const SUBMIT_WORDS =
    /submit|send|sign ?(in|up)|log ?in|register|subscribe|save|continue|next|join|apply|create|book|order|pay|confirm|search|go\b/i;

  // ---- traps: record, never block (the network sandbox in Node does the blocking) ----
  let roots: Element[] = [];
  addEventListener(
    'submit',
    (event) => {
      const form = event.target as HTMLFormElement;
      // A form or submitter aimed at a new window would escape page-level interception.
      if (form.target && form.target !== '_self') form.target = '_self';
      const submitter = (event as SubmitEvent).submitter;
      if (submitter?.hasAttribute('formtarget')) submitter.removeAttribute('formtarget');
      setTimeout(() =>
        events.submits.push({ index: roots.indexOf(form), prevented: event.defaultPrevented }),
      );
    },
    true,
  );
  addEventListener(
    'invalid',
    (event) => {
      const el = event.target as HTMLInputElement;
      events.invalid.push(el.name || el.id || el.type);
    },
    true,
  );
  addEventListener('error', (event) => events.errors.push(String(event.message)));
  addEventListener('unhandledrejection', (event) =>
    events.errors.push(`unhandled rejection: ${String(event.reason?.message ?? event.reason)}`),
  );
  const consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    events.errors.push(args.map(String).join(' ').slice(0, 200));
    consoleError(...args);
  };
  window.open = (url?: string | URL) => {
    events.opened.push(String(url ?? ''));
    return null;
  };
  // Request interception does not see WebSocket frames: never let one connect.
  window.WebSocket = class extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 3;
    constructor(url: string | URL) {
      super();
      events.sockets.push(String(url));
      setTimeout(() => this.dispatchEvent(new Event('error')));
    }
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      events.workers.push(String(url));
      super(url, options);
    }
  };

  let staticForms = new Set<Element>();
  document.addEventListener('DOMContentLoaded', () => {
    staticForms = new Set(document.querySelectorAll('form'));
  });

  // ---- discovery ----
  const deepAll = (selector: string, root: ParentNode = document): Element[] => {
    const out: Element[] = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) out.push(...deepAll(selector, el.shadowRoot));
    }
    return out;
  };
  const parentOf = (el: Element) =>
    el.parentElement ?? ((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
  const isSubmitter = (el: Element) =>
    el.matches(
      'button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]',
    );
  const isButton = (el: Element) =>
    el.matches('button, input[type=submit], input[type=button], input[type=image], [role=button]');
  const skipped = (el: Element) =>
    !!el.closest('[data-vidimus-skip]') || skip.some((selector) => !!el.closest(selector));

  const findRoots = () => {
    const forms = deepAll('form').filter((form) => !skipped(form));
    const groups = new Map<Element, true>();
    for (const control of deepAll(CONTROLS)) {
      if ((control as HTMLInputElement).form || control.closest('form') || skipped(control))
        continue;
      if (SKIPPED_TYPES.has((control as HTMLInputElement).type)) continue;
      // ponytail: nearest ancestor holding a button is the group; misgroups pages with one
      // global "Save" for unrelated widgets. Adapters can supply exact roots if that bites.
      for (let node = parentOf(control); node && node !== document.documentElement; ) {
        if (deepAll('button, input[type=submit], [role=button]', node).length) {
          if (!skipped(node)) groups.set(node, true);
          break;
        }
        node = parentOf(node);
      }
    }
    const nested = [...groups.keys()];
    const next = [...forms, ...nested.filter((g) => !nested.some((o) => o !== g && o.contains(g)))];
    // A form the page adds later (a search dialog) goes last, so indexes already handed out
    // keep pointing at the same element.
    roots =
      roots.length && roots.every((r) => next.includes(r))
        ? [...roots, ...next.filter((r) => !roots.includes(r))]
        : next;
    return roots;
  };
  const rootAt = (index: number) => {
    if (!roots[index]?.isConnected) findRoots();
    const root = roots[index];
    if (!root) throw new Error(`form #${index} is gone`);
    return root;
  };

  const controlsOf = (root: Element): Element[] =>
    root instanceof HTMLFormElement
      ? [...root.elements].filter((el) => el.matches(CONTROLS))
      : deepAll(CONTROLS, root).filter((el) => !(el as HTMLInputElement).form);

  const text = (el: Element | null | undefined) =>
    (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const labelOf = (el: HTMLInputElement) => {
    const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    return (
      el.getAttribute('aria-label') ||
      ids.map((id) => text(document.getElementById(id))).join(' ') ||
      text(el.labels?.[0]) ||
      el.placeholder ||
      el.name ||
      el.id
    ).trim();
  };
  const usable = (el: HTMLInputElement) =>
    !el.disabled &&
    !el.readOnly &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' &&
    !el.closest('[aria-hidden=true], [inert]');

  // ---- adapters ----
  type Rules = Partial<FieldInfo>;
  const reactFiber = (el: Element) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    // biome-ignore lint/suspicious/noExplicitAny: React internals are untyped
    return key ? (el as any)[key] : null;
  };
  // react-hook-form keeps its rules in control._fields[name]._f and errors in control._formState.
  // biome-ignore lint/suspicious/noExplicitAny: react-hook-form internals are untyped
  const rhfControl = (el: Element): any => {
    for (let fiber = reactFiber(el); fiber; fiber = fiber.return) {
      if (fiber.memoizedProps?.control?._fields) return fiber.memoizedProps.control;
      for (let hook = fiber.memoizedState; hook && typeof hook === 'object'; hook = hook.next) {
        const current = hook.memoizedState?.current;
        if (current?.control?._fields) return current.control;
      }
    }
    return null;
  };
  // biome-ignore lint/suspicious/noExplicitAny: walk a dotted path in an untyped object
  const at = (object: any, path: string) =>
    path.split('.').reduce((node, part) => node?.[part], object);
  // biome-ignore lint/suspicious/noExplicitAny: rule values are primitives or { value }
  const ruleValue = (rule: any) =>
    rule && typeof rule === 'object' && 'value' in rule ? rule.value : rule;
  const rhfRules = (el: HTMLInputElement): Rules | undefined => {
    const f = at(rhfControl(el)?._fields, el.name)?._f;
    if (!f) return undefined;
    const rules: Rules = { custom: [] };
    if (ruleValue(f.required)) rules.required = true;
    for (const key of ['minLength', 'maxLength'] as const) {
      const value = Number(ruleValue(f[key]));
      if (Number.isFinite(value) && ruleValue(f[key]) !== undefined) rules[key] = value;
    }
    for (const key of ['min', 'max'] as const)
      if (ruleValue(f[key]) !== undefined) rules[key] = String(ruleValue(f[key]));
    const pattern = ruleValue(f.pattern);
    if (pattern instanceof RegExp) rules.pattern = pattern.source;
    if (f.validate) rules.custom = ['validate'];
    return rules;
  };
  const frameworkState = (el: HTMLInputElement): Layer => {
    const control = rhfControl(el);
    if (control) return at(control._formState?.errors, el.name) ? 'invalid' : 'valid';
    // Angular mirrors control status into ng-* classes, also in production builds.
    const ng = el.closest('.ng-invalid, .ng-valid');
    if (ng && (el.classList.contains('ng-invalid') || el.classList.contains('ng-valid')))
      return el.classList.contains('ng-invalid') ? 'invalid' : 'valid';
    return 'n/a';
  };
  const adaptersOf = (root: Element, controls: Element[]) => {
    const names = ['native'];
    if (controls.some((el) => rhfControl(el))) names.push('react-hook-form');
    if (
      root.matches('.ng-valid, .ng-invalid') ||
      controls.some((el) => el.matches('.ng-valid, .ng-invalid'))
    )
      names.push('angular');
    return names;
  };

  // ---- fields ----
  const fieldsOf = (root: Element) => {
    const keys = new Map<string, Element[]>();
    const hidden: string[] = [];
    for (const el of controlsOf(root) as HTMLInputElement[]) {
      if (el.type === 'hidden') {
        hidden.push(el.name);
        continue;
      }
      if (SKIPPED_TYPES.has(el.type)) continue;
      // Angular reactive forms and Vue v-model often leave name unset.
      const named =
        el.name ||
        el.getAttribute('formcontrolname') ||
        el.getAttribute('ng-reflect-name') ||
        el.id;
      let key = el.type === 'radio' ? named : named || `${el.tagName.toLowerCase()}${keys.size}`;
      if (el.type !== 'radio' && keys.has(key)) key = `${key}#${keys.size}`;
      keys.set(key, [...(keys.get(key) ?? []), el]);
    }
    return { keys, hidden };
  };
  const describeField = (key: string, els: Element[]): FieldInfo => {
    const el = els[0] as HTMLInputElement;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? el.type : tag;
    const number = (attr: string) => {
      const raw = el.getAttribute(attr);
      return raw === null || raw === '' ? undefined : Number(raw);
    };
    const attr = (name: string) => el.getAttribute(name) ?? undefined;
    const options =
      type === 'radio'
        ? (els as HTMLInputElement[]).map((radio) => ({
            value: radio.value,
            disabled: radio.disabled,
          }))
        : tag === 'select'
          ? [...(el as unknown as HTMLSelectElement).options].map((o) => ({
              value: o.value,
              disabled: o.disabled,
            }))
          : [];
    const info: FieldInfo = {
      key,
      name: el.name,
      id: el.id,
      tag,
      type,
      label: labelOf(el),
      autocomplete: el.getAttribute('autocomplete') ?? '',
      usable: (els as HTMLInputElement[]).some(usable),
      required:
        (els as HTMLInputElement[]).some((e) => e.required) ||
        el.getAttribute('aria-required') === 'true',
      minLength: number('minlength'),
      maxLength: number('maxlength'),
      min: attr('min'),
      max: attr('max'),
      step: attr('step'),
      pattern: attr('pattern'),
      accept: attr('accept'),
      multiple: el.multiple,
      options,
      custom: [],
    };
    // Attributes win; adapter rules fill what the markup does not declare.
    const rules = rhfRules(el);
    if (!rules) return info;
    const declared = info as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(rules))
      if (declared[name] === undefined) declared[name] = value;
    return { ...info, required: info.required || !!rules.required, custom: rules.custom ?? [] };
  };
  const fieldEls = (index: number) => fieldsOf(rootAt(index)).keys;
  const fieldEl = (index: number, key: string) => {
    const els = fieldEls(index).get(key);
    if (!els) throw new Error(`field ${key} is gone`);
    return els as HTMLInputElement[];
  };

  // ---- filling: native setters + events so React, Vue and Angular all see the change ----
  const setValue = (el: HTMLInputElement, value: string) => {
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const apply = (els: HTMLInputElement[], value: Value, hold: boolean) => {
    const el = els[0] as HTMLInputElement;
    let tail = '';
    if (el.type === 'checkbox') {
      if (el.checked !== !!value) el.click();
    } else if (el.type === 'radio') {
      const pick = els.find((radio) => radio.value === value);
      if (pick && !pick.checked) pick.click();
      if (value === null)
        for (const radio of els)
          if (radio.checked) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set?.call(
              radio,
              false,
            );
            radio.dispatchEvent(new Event('change', { bubbles: true }));
          }
    } else if (el.type === 'file') {
      if (!value) el.value = '';
    } else {
      el.focus();
      const text = String(value ?? '');
      // Text fields get their last character typed by Node, so the browser treats the edit as a
      // user edit (minlength is only checked after one) and frameworks see real key events.
      tail = hold ? text.slice(-1) : '';
      setValue(el, tail ? text.slice(0, -1) : text);
      if (!tail) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }
    }
    return tail;
  };
  const TYPED = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'textarea']);

  const submitterOf = (root: Element) => {
    const form = root instanceof HTMLFormElement ? root : null;
    const buttons = deepAll('*', root).filter(isButton);
    return ((form ? [...form.elements] : buttons).find(isSubmitter) ??
      buttons.find((b) => SUBMIT_WORDS.test(text(b) || (b as HTMLInputElement).value || '')) ??
      (form ? undefined : buttons.at(-1))) as HTMLElement | undefined;
  };

  const visibleText = (el: Element | null) =>
    el && el.getClientRects().length > 0 ? text(el) : '';
  const ERROR_TEXT =
    '[role=alert], [aria-live=assertive], mat-error, .invalid-feedback, .error-message, .field-error, .help-block.error, .error, .text-danger, .form-error';
  const UI_ERROR =
    /^(is-invalid|invalid|has-error|error|is-error|Mui-error|ant-form-item-has-error|mat-form-field-invalid|p-invalid|field-error|input-error)$/;

  window.__vidimus = {
    forms: () =>
      findRoots().map((root, index) => {
        const { keys, hidden } = fieldsOf(root);
        const controls = [...keys.values()].flat();
        const form = root instanceof HTMLFormElement ? root : null;
        const submitter = submitterOf(root);
        return {
          index,
          kind: form ? 'form' : 'group',
          id: root.id,
          name: root.getAttribute('name') ?? '',
          method: form ? form.method : '',
          // No action attribute: the form posts to whatever page it is on, the same form everywhere.
          action: form?.hasAttribute('action') ? form.action : '',
          ordinal: form && staticForms.has(form) ? [...staticForms].indexOf(form) : null,
          novalidate: !!form?.noValidate,
          submitter: submitter
            ? text(submitter) ||
              (submitter as HTMLInputElement).value ||
              submitter.tagName.toLowerCase()
            : '',
          adapters: adaptersOf(root, controls),
          fields: [...keys].map(([key, els]) => describeField(key, els)),
          hidden,
        };
      }),
    fill(index, values, target) {
      let tail = '';
      const order = Object.keys(values).sort((a, b) => Number(a === target) - Number(b === target));
      for (const key of order) {
        const els = fieldEls(index).get(key) as HTMLInputElement[] | undefined;
        if (!els) continue;
        const rest = apply(
          els,
          values[key] ?? null,
          key === target && TYPED.has((els[0] as HTMLInputElement).type),
        );
        if (key === target) tail = rest;
      }
      return tail;
    },
    focus: (index, key) => fieldEl(index, key)[0]?.focus(),
    blur(index, key) {
      const el = fieldEl(index, key)[0];
      el?.dispatchEvent(new Event('change', { bubbles: true }));
      el?.blur();
    },
    element: (index, key) => fieldEls(index).get(key)?.[0] ?? null,
    root: (index) => rootAt(index),
    observe(index) {
      const out: Record<string, FieldState> = {};
      const fields = fieldEls(index);
      // Visible error text that is not wired to a field belongs to the control right before it,
      // the usual "message under the input" layout.
      const owners = new Map<string, string[]>();
      const controls = [...fields].flatMap(([key, els]) => els.map((el) => [key, el] as const));
      for (const message of deepAll(ERROR_TEXT, rootAt(index))) {
        const said = visibleText(message);
        if (!said || controls.some(([, el]) => message.contains(el))) continue;
        const owner = controls
          .filter(
            ([, el]) => el.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
          )
          .at(-1);
        if (owner) owners.set(owner[0], [...(owners.get(owner[0]) ?? []), said]);
      }
      for (const [key, els] of fields) {
        const el = els[0] as HTMLInputElement;
        const flags = Object.keys(Object.getPrototypeOf(el.validity)).filter(
          (flag) => flag !== 'valid' && el.validity[flag as keyof ValidityState],
        );
        const ids =
          `${el.getAttribute('aria-describedby') ?? ''} ${el.getAttribute('aria-errormessage') ?? ''}`
            .split(/\s+/)
            .filter(Boolean);
        const messages = [
          ...new Set([
            ...ids.map((id) => visibleText(document.getElementById(id))).filter(Boolean),
            ...(owners.get(key) ?? []),
          ]),
        ];
        let ui = false;
        for (
          let node: Element | null = el, depth = 0;
          node && depth < 4;
          node = node.parentElement, depth++
        )
          if ([...node.classList].some((name) => UI_ERROR.test(name))) ui = true;
        const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
        out[key] = {
          ...(!['checkbox', 'radio', 'file'].includes(el.type) && { value: el.value }),
          native: el.willValidate ? (el.validity.valid ? 'valid' : 'invalid') : 'n/a',
          flags,
          framework: frameworkState(el),
          ui: ui || ariaInvalid || messages.length ? 'invalid' : 'valid',
          ariaInvalid,
          messages,
        };
      }
      return out;
    },
    submit(index, times) {
      const root = rootAt(index);
      const form = root instanceof HTMLFormElement ? root : null;
      const button = submitterOf(root);
      if (!button && !form) return false;
      for (let i = 0; i < times; i++) {
        // A form with no button still submits on Enter (implicit submission).
        if (button) button.click();
        else form?.requestSubmit();
      }
      return true;
    },
    drain() {
      events.canary = !!document.querySelector('[data-vidimus-canary]');
      const copy = structuredClone(events);
      events.submits = [];
      events.invalid = [];
      events.errors = [];
      events.sockets = [];
      events.opened = [];
      events.workers = [];
      return copy;
    },
  };
};
/* node:coverage enable */

// The documentation site of the repository (`make docs-build`; docs/plans/fsm-v1.md, C-8). The site is built from the
// repository documents in place: srcDir is the repository root, and srcExclude keeps every Markdown file outside the include
// list of C-8. A README.md renders as the index page of its directory (rewrites); README.ko.md keeps its own route. A link to
// a repository file or directory that is not a site page points to the public repository (repositoryLinks). A link to a
// missing file is left as written, so the build reports it as a dead link: ignoreDeadLinks is not set.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defineConfig, type MarkdownOptions } from 'vitepress';

type MarkdownIt = Parameters<NonNullable<MarkdownOptions['config']>>[0];

const DOCS_DIR = path.dirname(fileURLToPath(import.meta.url));
const VUE_DIR = path.dirname(createRequire(import.meta.url).resolve('vue/package.json'));
const REPOSITORY = path.resolve(DOCS_DIR, '../..');
const PUBLIC_REPOSITORY = 'https://github.com/polyspec/fsm';
const base = process.env.VITEPRESS_BASE ?? '/';

// Directories that hold no document of the repository; srcExclude names them as well.
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'var', 'vendor', 'target', '.vitepress']);

// The language packages and the other packages, in the order of the sidebar (C-1).
const PACKAGES: Record<string, { en: string; ko: string }> = {
  compiler: { en: 'Compiler and CLI', ko: '컴파일러와 CLI' },
  db: { en: 'DB store', ko: 'DB 저장소' },
  gui: { en: 'GUI', ko: 'GUI' },
  go: { en: 'Go', ko: 'Go' },
  js: { en: 'npm (JavaScript and types)', ko: 'npm (JavaScript와 타입)' },
  php: { en: 'PHP', ko: 'PHP' },
  'php-ext': { en: 'PHP extension', ko: 'PHP 확장' },
  python: { en: 'Python', ko: 'Python' },
  rust: { en: 'Rust', ko: 'Rust' },
};

/** The Markdown files below the repository root, as posix paths; the skipped directories are not entered. */
function markdownFiles(relative = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(REPOSITORY, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...markdownFiles(name));
    } else if (entry.name.endsWith('.md')) {
      found.push(name);
    }
  }
  return found;
}

/** The include list of C-8: the root and package READMEs, the spec, the plan, the verification pages and the changelogs. */
function isSitePage(file: string): boolean {
  return /^(?:README|CHANGELOG)(?:\.ko)?\.md$/.test(file)
    || /^packages\/[^/]+\/README(?:\.ko)?\.md$/.test(file)
    || /^docs\/spec\/.+\.md$/.test(file)
    || /^docs\/plans\/fsm-v1(?:\.ko)?\.md$/.test(file)
    || /^docs\/verification\/.+\.md$/.test(file);
}

const MARKDOWN = markdownFiles();
const SITE_PAGES = new Set(MARKDOWN.filter(isSitePage));

/** The index page of a directory: its README.md is rewritten to index.md (a README.ko.md keeps its name). */
function indexOf(file: string): string {
  return /(?:^|\/)README\.md$/.test(file) ? file.replace(/README\.md$/, 'index.md') : file;
}

/** The site route of a site page: its path without .md, and the directory route of an index page. */
function routeOf(file: string): string {
  const page = indexOf(file).replace(/\.md$/, '');
  return page === 'index' ? '/' : `/${page.replace(/\/index$/, '/')}`;
}

/** The markdown-it rule: a link to a repository file or directory that is not a site page points to the public repository. */
function repositoryLinks(md: MarkdownIt): void {
  md.core.ruler.push('fsm-repository-links', (state) => {
    // markdown-it types the env of a rule as any; VitePress puts the relativePath of the rendered page in it.
    const env: unknown = state.env;
    const from = typeof env === 'object' && env !== null && 'relativePath' in env && typeof env.relativePath === 'string' ? env.relativePath : undefined;
    if (!from) return;
    for (const token of state.tokens) {
      for (const child of token.children ?? []) {
        if (child.type !== 'link_open') continue;
        const href = child.attrGet('href');
        // External links, same-page anchors and site-absolute links are not repository links.
        if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || /^[#/]/.test(href)) continue;
        const [location, fragment] = href.split('#', 2);
        if (!location) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), decodeURI(location)));
        if (target.startsWith('../') || target === '..') continue;
        const repositoryPath = target === '.' ? '' : target;
        if ([repositoryPath, `${repositoryPath}.md`, `${repositoryPath}/README.md`].some(candidate => SITE_PAGES.has(candidate))) continue;
        const local = path.join(REPOSITORY, repositoryPath);
        if (!existsSync(local)) continue;
        const kind = statSync(local).isDirectory() ? 'tree' : 'blob';
        child.attrSet('href', `${PUBLIC_REPOSITORY}/${kind}/main/${repositoryPath}${fragment ? `#${fragment}` : ''}`);
      }
    }
  });
}

/** The entries of one language: the overview, the specification, the plan, the packages, the verification and the changelog. */
function entriesOf(lang: 'en' | 'ko') {
  const suffix = lang === 'ko' ? '.ko' : '';
  const has = (file: string) => SITE_PAGES.has(file);
  const packages = Object.entries(PACKAGES)
    .filter(([name]) => has(`packages/${name}/README${suffix}.md`))
    .map(([name, labels]) => ({ text: `${labels[lang]} (${name})`, link: routeOf(`packages/${name}/README${suffix}.md`) }));
  const verification = [...SITE_PAGES]
    .filter(file => file.startsWith('docs/verification/') && file.endsWith('.ko.md') === (lang === 'ko'))
    .sort()
    .map(file => ({ text: path.posix.basename(file, '.md'), link: routeOf(file) }));
  return {
    overview: { text: lang === 'ko' ? '개요' : 'Overview', link: routeOf(`README${suffix}.md`) },
    specification: { text: lang === 'ko' ? '명세' : 'Specification', link: routeOf(`docs/spec/fsm${suffix}.md`) },
    plan: { text: lang === 'ko' ? '계획' : 'Plan', link: routeOf(`docs/plans/fsm-v1${suffix}.md`) },
    packages,
    verification,
    changelog: { text: lang === 'ko' ? '변경 이력' : 'Changelog', link: routeOf(`CHANGELOG${suffix}.md`) },
  };
}

const english = entriesOf('en');
const korean = entriesOf('ko');
const groupOf = (title: string, lang: 'en' | 'ko') => {
  const entries = entriesOf(lang);
  return {
    text: title,
    items: [
    entries.overview,
    entries.specification,
    entries.plan,
    { text: lang === 'ko' ? '패키지' : 'Packages', items: entries.packages },
    ...(entries.verification.length ? [{ text: lang === 'ko' ? '검증' : 'Verification', items: entries.verification }] : []),
    entries.changelog,
    ],
  };
};

export default defineConfig({
  base,
  title: 'fsm',
  description: 'fsm defines a state machine once and generates code for go, npm, php, php-ext, python and rust',
  // The repository root is the source; the config lives in docs/.vitepress, and the build writes into it.
  srcDir: REPOSITORY,
  outDir: path.join(DOCS_DIR, 'dist'),
  cacheDir: path.join(DOCS_DIR, 'cache'),
  srcExclude: [
    ...MARKDOWN.filter(file => !SITE_PAGES.has(file)),
    '**/node_modules/**',
    '**/.git/**',
    'var/**',
    '**/vendor/**',
    '**/target/**',
    'docs/.vitepress/**',
  ],
  rewrites: Object.fromEntries([...SITE_PAGES].filter(file => /(?:^|\/)README\.md$/.test(file)).map(file => [file, indexOf(file)])),
  cleanUrls: true,
  // The pages live at the repository root, where no node_modules holds vue, so the bare imports of the page modules name the
  // ESM entries of vue in docs/node_modules (the entries the theme imports, so one copy of vue is bundled). `vue` names the
  // runtime entry of its exports` import condition, not index.mjs: that file re-exports the CommonJS build and made vite print
  // "Circular chunk: framework -> theme -> framework" (docs/plans/fsm-v1.md, C-8, S-20-1).
  vite: {
    resolve: {
      alias: [
        { find: /^vue$/, replacement: path.join(VUE_DIR, 'dist/vue.runtime.esm-bundler.js') },
        { find: /^vue\/server-renderer$/, replacement: path.join(VUE_DIR, 'server-renderer/index.mjs') },
      ],
    },
  },
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: 'English', items: [english.overview, english.specification, english.plan, english.changelog] },
      { text: '한국어', items: [korean.overview, korean.specification, korean.plan, korean.changelog] },
    ],
    sidebar: [groupOf('English', 'en'), groupOf('한국어', 'ko')],
  },
  markdown: {
    config(md) {
      md.use(repositoryLinks);
    },
  },
});

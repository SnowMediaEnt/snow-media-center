/**
 * Shared by the two i18n guard tests (Node only, never imported by the app).
 * - coveredFiles(): the files listed in guard/covered/<item>.txt.
 * - findHardcodedText(): user-facing English left in a source file.
 * - findForbiddenIntl(): Intl features the Chrome 66 WebView does not have.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import glossary from '../glossary.json';

export const ROOT = path.resolve(__dirname, '../../..');
const COVERED_DIR = path.resolve(__dirname, 'covered');

export interface Finding {
  file: string;
  line: number;
  text: string;
  kind: string;
}

/** Every .ts/.tsx source (tests excluded) named by a covered/<item>.txt file, as repo-relative paths. */
export function coveredFiles(): string[] {
  const out = new Set<string>();
  const walk = (abs: string) => {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(abs)) walk(path.join(abs, name));
    } else if (/\.tsx?$/.test(abs) && !/\.(test|spec)\.tsx?$/.test(abs) && !abs.endsWith('.d.ts')) {
      out.add(path.relative(ROOT, abs).split(path.sep).join('/'));
    }
  };
  for (const list of fs.readdirSync(COVERED_DIR).filter((f) => f.endsWith('.txt'))) {
    const lines = fs.readFileSync(path.join(COVERED_DIR, list), 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      const abs = path.resolve(ROOT, line);
      if (!fs.existsSync(abs)) throw new Error(`${list}: "${line}" does not exist`);
      walk(abs);
    }
  }
  return [...out].sort();
}

const DNT = [...(glossary.doNotTranslate as string[])].sort((a, b) => b.length - a.length);

/** True when the text has real words left after removing brand words, numbers and symbols. */
export function needsTranslation(text: string): boolean {
  let rest = text;
  for (const word of DNT) rest = rest.split(word).join(' ');
  return /[A-Za-zÀ-ɏ؀-ۿ]{2,}/.test(rest.replace(/&\w+;/g, ' '));
}

const TEXT_PROPS = new Set(['label', 'placeholder', 'aria-label', 'title']);
const TOAST_PROPS = new Set(['title', 'description']);

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.ES2020, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** String pieces that would be shown, from a literal, a template, a ?: or an &&/||/?? /+ chain. */
function literalsIn(node: ts.Node | undefined): ts.Node[] {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node];
  if (ts.isTemplateExpression(node)) return [node.head, ...node.templateSpans.map((s) => s.literal)];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return literalsIn(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)];
  if (ts.isBinaryExpression(node)) return [...literalsIn(node.left), ...literalsIn(node.right)];
  return [];
}

const literalText = (n: ts.Node): string =>
  ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
    ? n.text
    : '';

function isToastCall(call: ts.CallExpression): boolean {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text === 'toast';
  if (ts.isPropertyAccessExpression(c)) {
    return (ts.isIdentifier(c.expression) && c.expression.text === 'toast') || c.name.text === 'toast';
  }
  return false;
}

export function findHardcodedText(file: string, source: string): Finding[] {
  const sf = parse(file, source);
  const lines = source.split('\n');
  const found: Finding[] = [];

  const ignored = (node: ts.Node): boolean => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    return /i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '');
  };
  const add = (node: ts.Node, text: string, kind: string) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || !needsTranslation(clean) || ignored(node)) return;
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: clean, kind });
  };
  const addLiterals = (expr: ts.Node | undefined, kind: string) => {
    for (const lit of literalsIn(expr)) add(lit, literalText(lit), kind);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      add(node, node.text, 'jsx-text');
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      addLiterals(node.expression, 'jsx-text');
    } else if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(sf))) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init, init.text, `prop ${node.name.getText(sf)}`);
      else if (init && ts.isJsxExpression(init)) addLiterals(init.expression, `prop ${node.name.getText(sf)}`);
    } else if (ts.isCallExpression(node) && isToastCall(node)) {
      const [first] = node.arguments;
      if (first && ts.isObjectLiteralExpression(first)) {
        for (const p of first.properties) {
          if (ts.isPropertyAssignment(p) && TOAST_PROPS.has(p.name.getText(sf))) addLiterals(p.initializer, `toast ${p.name.getText(sf)}`);
        }
      } else if (first) {
        addLiterals(first, 'toast');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const FORBIDDEN_INTL = new Set(['RelativeTimeFormat', 'ListFormat', 'Locale', 'DisplayNames', 'Segmenter']);
const FORBIDDEN_OPTIONS = new Set(['dateStyle', 'timeStyle']);

export function findForbiddenIntl(file: string, source: string): Finding[] {
  const sf = parse(file, source);
  const found: Finding[] = [];
  const add = (node: ts.Node, text: string) =>
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text, kind: 'chrome66-intl' });
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Intl' && FORBIDDEN_INTL.has(node.name.text)) {
      add(node, `Intl.${node.name.text}`);
    } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && FORBIDDEN_OPTIONS.has(node.name.getText(sf))) {
      add(node, node.name.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export const show = (f: Finding[]): string[] => f.map((x) => `${x.file}:${x.line} [${x.kind}] ${x.text}`);

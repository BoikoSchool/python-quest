// Редактор коду — обгортка над CodeMirror 6 (файл vendor/codemirror.js).
// Панель символів для екранної клавіатури з'явиться на етапі 2.

import {
  Decoration,
  EditorState,
  EditorView,
  HighlightStyle,
  StateEffect,
  StateField,
  bracketMatching,
  defaultKeymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  history,
  historyKeymap,
  indentOnInput,
  indentUnit,
  indentWithTab,
  keymap,
  lineNumbers,
  placeholder,
  python,
  syntaxHighlighting,
  tags,
} from '../vendor/codemirror.js';

// Кольори коду беруться з CSS-змінних (css/app.css), тож світла й темна теми перемикаються самі.
const pythonColors = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword],
    color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code-number)' },
  { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.function(tags.propertyName)],
    color: 'var(--code-function)' },
  { tag: [tags.className, tags.definition(tags.className)], color: 'var(--code-function)', fontWeight: '600' },
  { tag: [tags.self, tags.special(tags.variableName)], color: 'var(--code-keyword)' },
  { tag: tags.invalid, color: 'var(--code-invalid)' },
]);

const editorLook = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--code-size)',
    color: 'var(--code-text)',
    backgroundColor: 'var(--code-bg)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.55' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--code-caret)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-caret)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--code-gutter-bg)',
    color: 'var(--code-gutter-text)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-active-line)', color: 'var(--code-text)' },
  '.cm-errorLine': { backgroundColor: 'var(--code-error-line)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--code-bracket)', outline: 'none' },
  '::selection, .cm-content ::selection': { backgroundColor: 'var(--code-selection)' },
});

// Підсвічений рядок з помилкою. Зникає, щойно учень змінює код.
const setErrorLine = StateEffect.define();
const errorLine = StateField.define({
  create: () => Decoration.none,
  update(lines, tr) {
    if (tr.docChanged) lines = Decoration.none;
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLine)) continue;
      lines = effect.value === null
        ? Decoration.none
        : Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(tr.state.doc.line(effect.value).from)]);
    }
    return lines;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Створює редактор у parent.
 * onChange(code) викликається після кожної зміни тексту.
 * placeholderText — сірий текст-підказка, поки редактор порожній.
 */
export function createEditor(parent, { doc = '', onChange = () => {}, label = 'Код програми', placeholderText = '' } = {}) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        bracketMatching(),
        // У Python відступ — 4 пробіли. Після «:» і Enter наступний рядок отримує відступ сам.
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        python(),
        syntaxHighlighting(pythonColors),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        errorLine,
        editorLook,
        placeholderText ? placeholder(placeholderText) : [],
        // Без цього iPad робить з print → Print і підкреслює код як орфографічні помилки.
        EditorView.contentAttributes.of({
          autocorrect: 'off',
          autocapitalize: 'off',
          spellcheck: 'false',
          'aria-label': label,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    focus: () => view.focus(),
    /** Підсвітити рядок з помилкою (нумерація з 1) і прокрутити до нього. */
    showErrorLine(line) {
      if (!Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return;
      const pos = view.state.doc.line(line).from;
      view.dispatch({ effects: [setErrorLine.of(line), EditorView.scrollIntoView(pos, { y: 'center' })] });
    },
    clearErrorLine() {
      view.dispatch({ effects: setErrorLine.of(null) });
    },
    destroy: () => view.destroy(),
  };
}

// Keep the server's reviewed fallback bank identical to guest practice.
// Run after changing the bundled questions; the output never contains secrets.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function initializer(path, name) {
  const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) === name) return declaration.initializer.getText(source);
    }
  }
  throw new Error(`Missing ${name}`);
}
const evaluate = (expression, context = {}) => vm.runInNewContext(ts.transpile(`(${expression})`, { target: ts.ScriptTarget.ES2022 }), context);
const snowQuestion = evaluate(initializer('src/lib/triviaQuestions.ts', 'snowQuestion'));
const snow = evaluate(initializer('src/lib/triviaQuestions.ts', 'SNOW_MEDIA_TRIVIA_FALLBACK'), { snowQuestion });
const bank = evaluate(initializer('src/components/games/TVTrivia.tsx', 'TRIVIA_QUESTIONS'), { SNOW_MEDIA_TRIVIA_FALLBACK: snow });
fs.mkdirSync('server/game-room/src/games', { recursive: true });
fs.writeFileSync('server/game-room/src/games/triviaBank.json', JSON.stringify(bank, null, 2) + '\n');
console.log(`Exported ${bank.length} reviewed trivia questions.`);

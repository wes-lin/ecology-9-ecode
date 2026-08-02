const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const { compileJavaScript, compileJavaScriptFile } = require('../dist');

describe('JavaScript compiler', () => {
  it('should compile legacy class and class-property decorators', () => {
    const compiled = compileJavaScript(`
      @sealed
      class Example {
        @readonly
        value = 1;
      }
    `);

    assert.doesNotMatch(compiled, /@sealed|@readonly/);
    assert.match(compiled, /sealed/);
    assert.match(compiled, /readonly/);
    assert.match(compiled, /_applyDecoratedDescriptor/);
  });

  it('should synchronously compile a JavaScript file to the requested output path', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-compiler-'));
    const inputPath = path.join(temporaryDirectory, 'src', 'index.js');
    const outputPath = path.join(temporaryDirectory, 'dist', 'compiled_index.js');

    try {
      fs.mkdirSync(path.dirname(inputPath), { recursive: true });
      fs.writeFileSync(inputPath, 'const view = <div>Hello</div>;', 'utf8');

      const compiled = compileJavaScriptFile(inputPath, outputPath);

      assert.equal(fs.readFileSync(outputPath, 'utf8'), compiled);
      assert.match(compiled, /React\.createElement/);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('should reject overwriting the source file', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecode-compiler-'));
    const inputPath = path.join(temporaryDirectory, 'index.js');

    try {
      fs.writeFileSync(inputPath, 'const value = 1;', 'utf8');
      assert.throws(() => compileJavaScriptFile(inputPath, inputPath), /must not overwrite the source file/);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

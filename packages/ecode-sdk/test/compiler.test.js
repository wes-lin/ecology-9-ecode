const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { compileJavaScript } = require('../dist');

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
});

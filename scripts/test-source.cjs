// Extract test subjects by syntax, independent of line wrapping and quote style.
const { parsers } = require('prettier/plugins/babel');
function statement(source, predicate) {
  const node = parsers.babel.parse(source).program.body.find(predicate);
  if (!node) throw new Error('Test subject not found in main.js');
  return node;
}
function ipcNode(source, channel) {
  return statement(
    source,
    (node) =>
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.type === 'MemberExpression' &&
      node.expression.callee.object.name === 'ipcMain' &&
      node.expression.callee.property.name === 'handle' &&
      node.expression.arguments[0]?.value === channel,
  );
}
function ipc(source, channel) {
  const node = ipcNode(source, channel);
  return source.slice(node.start, node.end);
}
function namedFunction(source, name) {
  const node = statement(
    source,
    (node) => node.type === 'FunctionDeclaration' && node.id.name === name,
  );
  return source.slice(node.start, node.end);
}
module.exports = {
  ipc,
  namedFunction,
  ipcStart: (source, channel) => ipcNode(source, channel).start,
};

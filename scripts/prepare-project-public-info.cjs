// Packaging hook only. Never copy the private source JSON or unknown fields.
const fs = require('fs'),
  path = require('path');
const { ProjectInfoEngine, sanitize, sanitizeBank } = require('../src/engines/project-info-engine');
module.exports = async (context) => {
  const root = context.packager.projectDir;
  const engine = new ProjectInfoEngine(root, root, false),
    source = engine.readSource();
  const output = {
    'git-issues': require('../src/engines/bug-report-engine').issueBase(source?.['git-issues']),
    paypal: sanitize(source).paypal,
    'report-email': source?.['report-email'] || sanitize(source).gmail?.replace(/^mailto:/i,''),
    bank_account_informations: sanitizeBank(source?.bank_account_informations),
  };
  fs.writeFileSync(
    path.join(root, 'data', 'project-public-info.json'),
    JSON.stringify(output, null, 2),
    'utf8',
  );
};

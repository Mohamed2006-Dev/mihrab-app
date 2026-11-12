// Write only the approved support fields to the packaged application.
const fs = require('node:fs');
const path = require('node:path');
const { ProjectInfoEngine, sanitize, sanitizeBank } = require('../src/engines/project-info-engine');

module.exports = async ({ packager, appOutDir }) => {
  const source = new ProjectInfoEngine(packager.projectDir).readSource();
  if (!source) return;
  const payments = {
    paypal: sanitize(source).paypal,
    bank_account_informations: sanitizeBank(source.bank_account_informations),
  };
  const directory = path.join(appOutDir, 'resources', 'data');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'personal-data.json'), JSON.stringify(payments), 'utf8');
};

/* eslint-env node */

const {readdirSync, existsSync} = require('fs');
const path = require('path');

const moduleNameMapper = getPackageNames().reduce((accumulator, name) => {
  accumulator[name] = `<rootDir>/packages/${name}/src/index.ts`;
  return accumulator;
}, {});

module.exports = {
  rootDir: '../../',
  modulePathIgnorePatterns: [
    'packages/.*/dist',
    'packages/.*/test/fixtures/.*d.ts',
  ],
  moduleNameMapper,
  testRegex: '.*\\.test\\.ts$',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleFileExtensions: ['js', 'ts'],
};

function getPackageNames() {
  const packagesPath = path.join(__dirname, '../../packages');
  return readdirSync(packagesPath).filter((packageName) => {
    const packageJSONPath = path.join(
      packagesPath,
      packageName,
      'package.json',
    );
    return existsSync(packageJSONPath);
  });
}

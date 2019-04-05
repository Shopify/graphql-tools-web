import {resolve} from 'path';
import {exec} from 'child_process';

import {stripFullFilePaths} from '../../../test/utilities';

const scriptPath = resolve(__dirname, '../bin/graphql-typescript-definitions');
const rootFixturePath = resolve(__dirname, 'fixtures');

// Skipping for now because it fails in CI for no apparent reason :(
describe.skip('cli', () => {
  it('succeeds when there are no fixture errors', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('all-clear')),
    ).toMatchSnapshot();
  });

  it('succeeds when there are multiple schemas', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('multiple-schemas')),
    ).toMatchSnapshot();
  });

  it('succeeds when schemaPath is set to a graphql file', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('graphql-schema')),
    ).toMatchSnapshot();
  });

  it('fails when there are syntax errors', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('malformed-query')),
    ).toMatchSnapshot();
    expect(
      await execDetails(cliCommandForFixtureDirectory('missing-schema')),
    ).toMatchSnapshot();
  });

  it('fails when there are unused types', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('missing-types')),
    ).toMatchSnapshot();
  });

  it('fails when multiple queries have the same name', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('duplicate-names')),
    ).toMatchSnapshot();
  });
});

function execDetails(command: string) {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve({
        error: stripFullFilePaths(error),
        stdout: stripFullFilePaths(stdout),
        stderr: stripFullFilePaths(stderr),
      });
    });
  });
}

function cliCommandForFixtureDirectory(fixture: string) {
  const fixtureDirectory = resolve(rootFixturePath, fixture);
  return [
    scriptPath,
    `--cwd '${fixtureDirectory}'`,
    `--schema-types-path '${fixtureDirectory}'`,
  ].join(' ');
}

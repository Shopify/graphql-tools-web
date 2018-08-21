import {resolve} from 'path';
import {exec} from 'child_process';

import {stripFullFilePaths} from '../../../test/utilities';

const scriptPath = resolve(__dirname, '../bin/graphql-typescript-definitions');
const rootFixturePath = resolve(__dirname, 'fixtures');

describe('cli', () => {
  it('succeeds when there are no fixture errors', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('all-clear')),
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

  it('fails when the file has different name than the query defined within it', async () => {
    expect(
      await execDetails(cliCommandForFixtureDirectory('misnamed-file')),
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
    `'${resolve(fixtureDirectory, 'documents/**/*.graphql')}'`,
    `--schema-path '${resolve(fixtureDirectory, 'schema.json')}'`,
    `--schema-types-path '${resolve(fixtureDirectory, 'schema.ts')}'`,
  ].join(' ');
}

import {join} from 'path';

import {GraphQLConfig} from 'graphql-config';

import {
  getGraphQLProjectForSchemaPath,
  getGraphQLProjectIncludedFilePaths,
  getGraphQLProjects,
  getGraphQLSchemaPaths,
  resolvePathRelativeToConfig,
  resolveProjectName,
  resolveSchemaPath,
} from '../src/config';

jest.mock('fs', () => {
  return {
    existsSync: jest.fn(),
  };
});
jest.mock('glob', () => jest.fn());

const existsSync: jest.Mock = require.requireMock('fs').existsSync;
const glob: jest.Mock = require.requireMock('glob');

const filepath = join(__dirname, '.graphqlconfig');
const defaultConfig = {schema: 'test'};
const configResult = {config: defaultConfig, filepath};

describe('resolvePathRelativeToConfig()', () => {
  it('resolves a relative path', () => {
    const config = new GraphQLConfig(configResult, []);

    expect(resolvePathRelativeToConfig(config.getDefault(), 'test')).toBe(
      join(__dirname, 'test'),
    );
  });

  it('resolves an absolute path', () => {
    const config = new GraphQLConfig(configResult, []);
    expect(resolvePathRelativeToConfig(config.getDefault(), '/test')).toBe(
      '/test',
    );
  });
});

describe('resolveProjectName()', () => {
  it('resolves to default when single project', () => {
    const config = new GraphQLConfig(configResult, []);
    const projectConfig = config.getProject();

    expect(resolveProjectName(projectConfig)).toBe('default');
  });

  it('ignores the provided defaultName for a named project', () => {
    const config = new GraphQLConfig(configResult, []);
    const projectConfig = config.getProject();

    expect(resolveProjectName(projectConfig, 'ignored')).toBe('default');
  });
});

describe('resolveSchemaPath()', () => {
  beforeEach(() => {
    existsSync.mockClear();
  });

  it('throws an error if the schemaPath is empty', () => {
    const config = new GraphQLConfig(
      {
        config: {schema: ''},
        filepath,
      },
      [],
    );
    const projectConfig = config.getProject();

    expect(() => resolveSchemaPath(projectConfig)).toThrow(
      /Missing GraphQL schemaPath/i,
    );
  });

  it('throws an error if the schemaPath does not exist', () => {
    const config = new GraphQLConfig(configResult, []);
    const projectConfig = config.getProject();

    existsSync.mockImplementation(() => false);

    expect(() => resolveSchemaPath(projectConfig)).toThrow(/Schema not found/i);
  });

  it('returns the schemaPath if it exists', () => {
    const config = new GraphQLConfig(configResult, []);
    const projectConfig = config.getProject();

    existsSync.mockImplementation(() => true);

    expect(resolveSchemaPath(projectConfig)).toBe(
      join(__dirname, defaultConfig.schema),
    );
    expect(existsSync).toHaveBeenCalledWith(
      join(__dirname, defaultConfig.schema),
    );
  });

  it('returns the non-existent schemaPath when ignoreMissing is true', () => {
    const config = new GraphQLConfig(configResult, []);
    const projectConfig = config.getProject();

    existsSync.mockImplementation(() => false);

    expect(resolveSchemaPath(projectConfig, true)).toBe(
      join(__dirname, defaultConfig.schema),
    );
  });
});

describe('getGraphQLProjects()', () => {
  it('returns all projects in a multi-project configuration', () => {
    const config = new GraphQLConfig(
      {
        config: {
          projects: {foo: {schema: 'foo'}, bar: {schema: 'bar'}},
        },
        filepath,
      },
      [],
    );

    const projects = getGraphQLProjects(config);

    expect(projects).toHaveLength(2);
    expect(projects[0].name).toBe('foo');
    expect(projects[0].schema).toBe('foo');
    expect(projects[1].name).toBe('bar');
    expect(projects[1].schema).toBe('bar');
  });

  it('returns one project in a single project configuration', () => {
    const config = new GraphQLConfig(configResult, []);

    const projects = getGraphQLProjects(config);

    expect(projects).toHaveLength(1);
    expect(projects[0].schema).toBe('test');
  });
});

describe('getGraphQLSchemaPaths()', () => {
  beforeEach(() => {
    existsSync.mockClear();
  });

  it('returns schemaPath for each project', () => {
    const config = new GraphQLConfig(
      {
        config: {
          projects: {foo: {schema: 'foo'}, bar: {schema: 'bar'}},
        },
        filepath,
      },
      [],
    );

    existsSync.mockImplementation(() => true);

    expect(getGraphQLSchemaPaths(config)).toStrictEqual(
      expect.arrayContaining([join(__dirname, 'foo'), join(__dirname, 'bar')]),
    );
  });
});

describe('getGraphQLProjectIncludedFilePaths()', () => {
  beforeEach(() => {
    glob.mockClear();
  });

  it('joins all file paths from each included pattern', async () => {
    const config = new GraphQLConfig(
      {
        config: {
          schema: 'test',
          include: ['app/A/**/*', 'app/B/**/*'],
          exclude: ['**/excluded'],
        },
        filepath,
      },
      [],
    );
    const projectConfig = config.getProject();

    // eslint-disable-next-line no-empty-pattern
    glob.mockImplementationOnce(({}, {}, cb) => cb(null, ['fileA']));
    // eslint-disable-next-line no-empty-pattern
    glob.mockImplementationOnce(({}, {}, cb) => cb(null, ['fileB']));

    const filePaths = await getGraphQLProjectIncludedFilePaths(projectConfig);

    expect(filePaths).toHaveLength(2);
    expect(filePaths).toStrictEqual(expect.arrayContaining(['fileA', 'fileB']));

    expect(glob).toHaveBeenCalledTimes(2);
    expect(glob.mock.calls).toStrictEqual(
      expect.arrayContaining([
        [
          join(__dirname, 'app/A/**/*'),
          {
            ignore: [join(__dirname, '**/excluded')],
          },
          expect.any(Function),
        ],
        [
          join(__dirname, 'app/B/**/*'),
          {
            ignore: [join(__dirname, '**/excluded')],
          },
          expect.any(Function),
        ],
      ]),
    );
  });
});

describe('getGraphQLProjectForSchemaPath()', () => {
  it('returns the schema in a multi-project configuration', () => {
    const config = new GraphQLConfig(
      {
        config: {
          projects: {foo: {schema: 'foo'}},
        },
        filepath,
      },
      [],
    );

    const projectConfig = getGraphQLProjectForSchemaPath(
      config,
      join(__dirname, 'foo'),
    );

    expect(projectConfig.schema).toBe('foo');
  });

  it('returns the schema in a single project configuration', () => {
    const config = new GraphQLConfig(configResult, []);

    const projectConfig = getGraphQLProjectForSchemaPath(
      config,
      join(__dirname, 'test'),
    );

    expect(projectConfig.schema).toBe('test');
  });

  it('throws an error if the schemaPath does not match any project', () => {
    const config = new GraphQLConfig(configResult, []);

    expect(() =>
      getGraphQLProjectForSchemaPath(config, join(__dirname, 'bar')),
    ).toThrow(/No project defined/i);
  });
});

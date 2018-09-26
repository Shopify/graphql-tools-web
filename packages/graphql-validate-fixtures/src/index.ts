import {readFile, readJSON} from 'fs-extra';
import {resolve} from 'path';
import * as glob from 'glob';
import {Source, parse, concatAST, GraphQLSchema} from 'graphql';
import {getGraphQLConfig, GraphQLProjectConfig} from 'graphql-config';
import {AST, compile, Operation} from 'graphql-tool-utilities/ast';
import {
  getGraphQLFilePath,
  getGraphQLProjects,
} from 'graphql-tool-utilities/config';

import {
  getOperation,
  validateFixtureAgainstAST,
  Validation,
  Fixture,
  MissingOperationError,
} from './validate';

export interface Options {
  cwd: string;
}

export interface Evaluation extends Validation {
  scriptError?: Error;
}

export async function evaluateFixtures(
  fixturePaths: string[],
  {cwd}: Options,
): Promise<Evaluation[]> {
  const config = getGraphQLConfig(resolve(cwd));

  const projectOperations = await Promise.all(
    getGraphQLProjects(config).map(getOperationsForProject),
  );

  return runForEachFixture(fixturePaths, (fixture) =>
    evaluateFixture(fixture, projectOperations),
  );
}

interface FixtureOperation {
  ast: AST;
  error?: any;
  operation: Operation;
  operationName: string;
}

interface FixtureOperationError {
  ast: AST;
  error: any;
  operation?: Operation;
  operationName?: string;
}

function evaluateFixture(
  fixture: Fixture,
  projectOperations: GraphQLProjectOperations[],
): Evaluation {
  const fixtureOperations = projectOperations.map<
    FixtureOperation | FixtureOperationError
  >(({ast}) => {
    try {
      return {
        ast,
        ...getOperation(fixture, ast),
      };
    } catch (error) {
      return {
        ast,
        error,
        operation: undefined,
        operationName: undefined,
      };
    }
  });

  const validFixtureOperations = fixtureOperations.filter(
    ({operation, error}) => {
      return operation != null && error == null;
    },
  ) as FixtureOperation[];

  if (validFixtureOperations.length > 1) {
    const [{operationName}] = validFixtureOperations;
    const projectNames = projectOperations
      .map(({config}) => config.resolveProjectName())
      .join(', ');

    return {
      fixturePath: fixture.path,
      validationErrors: [
        new Error(
          `Ambiguous operation name '${operationName}' in '${
            fixture.path
          }' for projects: ${projectNames}`,
        ),
      ],
    };
  }

  if (validFixtureOperations.length === 0) {
    let errors = fixtureOperations
      .filter(({operation}) => operation != null)
      .map(({error}) => error);

    if (errors.length === 0) {
      // we couldn't find an error in a valid fixture, fallback on all errors
      errors = fixtureOperations.map(({error}) => error);
    }

    return {
      fixturePath: fixture.path,
      validationErrors: mergeMissingOperationErrors(errors),
    };
  }

  const [{ast}] = validFixtureOperations;

  return validateFixtureAgainstAST(fixture, ast);
}

function mergeMissingOperationErrors(errors: any[]) {
  if (errors.length <= 1) {
    return errors;
  }

  const {otherErrors, operationNames} = errors.reduce<{
    otherErrors: any[];
    operationNames: string[];
  }>(
    ({otherErrors, operationNames}, error) => {
      if (error instanceof MissingOperationError) {
        operationNames.push(...error.operationNames);
      } else {
        otherErrors.push(error);
      }

      return {otherErrors, operationNames};
    },
    {otherErrors: [], operationNames: []},
  );

  return [
    new Error(
      `${errors[0].message}. Available operations: ${operationNames.join(
        ', ',
      )}`,
    ),
    ...otherErrors,
  ];
}

interface GraphQLProjectOperations {
  config: GraphQLProjectConfig;
  ast: AST;
}

async function getOperationsForProject(
  projectConfig: GraphQLProjectConfig,
): Promise<GraphQLProjectOperations> {
  const operationPaths = projectConfig.includes
    .map((filePath) => getGraphQLFilePath(projectConfig, filePath))
    .reduce<string[]>((filePaths, pattern) => {
      return filePaths.concat(glob.sync(pattern));
    }, [])
    .filter((operationPath) => projectConfig.includesFile(operationPath));

  const operationSources = await Promise.all(
    operationPaths.map(
      async (operationPath) =>
        new Source(await readFile(operationPath, 'utf8'), operationPath),
    ),
  );

  const document = concatAST(
    operationSources.map((source) => {
      try {
        return parse(source);
      } catch (error) {
        throw new Error(
          `Error parsing '${source.name}':\n\n${error.message.replace(
            /Syntax Error.*?\(.*?\) /,
            '',
          )}`,
        );
      }
    }),
  );

  let schema: GraphQLSchema;

  try {
    schema = projectConfig.getSchema();
  } catch (error) {
    throw new Error(
      `Error parsing '${projectConfig.schemaPath}':\n\n${error.message.replace(
        /Syntax Error.*?\(.*?\) /,
        '',
      )}`,
    );
  }

  return {
    ast: compile(schema, document),
    config: projectConfig,
  };
}

function runForEachFixture<T extends Partial<Evaluation>>(
  fixturePaths: string[],
  runner: (fixture: Fixture) => T,
): Promise<Evaluation[]> {
  return Promise.all(
    fixturePaths.map(async (fixturePath) => {
      try {
        const fixture = await readJSON(fixturePath);
        return {
          fixturePath,
          ...(runner({path: fixturePath, content: fixture}) as any),
        };
      } catch (error) {
        return {
          fixturePath,
          scriptError: error,
          validationErrors: [],
        };
      }
    }),
  );
}

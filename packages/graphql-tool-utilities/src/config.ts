import {promisify} from 'util';
import {GraphQLConfig, GraphQLProjectConfig} from 'graphql-config';

import './augmentations';
import './polyfills';
import {resolvePathRelativeToConfig, resolveSchemaPath} from './utilities';

// we need to use an import/require here because it does not force consumers to
// enable esModuleInterop in tsconfig.json
import glob = require('glob');

export function getGraphQLProjects(config: GraphQLConfig) {
  const projects = config.getProjects();

  if (projects) {
    // multi-project configuration, return an array of projects
    return Object.values(projects);
  }

  const project = config.getProjectConfig();

  if (project && project.schemaPath) {
    // single project configuration, return an array of the single project
    return [project];
  }

  // invalid project configuration
  throw new Error(`No projects defined in '${config.configPath}'`);
}

export function getGraphQLSchemaPaths(config: GraphQLConfig) {
  return getGraphQLProjects(config).reduce<string[]>((schemas, project) => {
    return schemas.concat(resolveSchemaPath(project));
  }, []);
}

export async function getGraphQLProjectIncludedFilePaths(
  projectConfig: GraphQLProjectConfig,
) {
  return (await Promise.all(
    projectConfig.includes.map((include) =>
      promisify(glob)(resolvePathRelativeToConfig(projectConfig, include), {
        ignore: projectConfig.excludes.map((exclude) =>
          resolvePathRelativeToConfig(projectConfig, exclude),
        ),
      }),
    ),
  )).flatMap((filePaths) => filePaths);
}

export function getGraphQLProjectForSchemaPath(
  config: GraphQLConfig,
  schemaPath: string,
) {
  const project =
    getGraphQLProjects(config)
      .filter((project) => project.schemaPath === schemaPath)
      .shift() || config.getProjectConfig();

  if (!project || project.schemaPath !== schemaPath) {
    throw new Error(
      `No project defined in graphql config for schema '${schemaPath}'`,
    );
  }

  return project;
}

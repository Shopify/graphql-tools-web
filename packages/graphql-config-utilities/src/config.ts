import {existsSync} from 'fs';
import {resolve} from 'path';
import {promisify} from 'util';

import {GraphQLConfig, GraphQLProjectConfig} from 'graphql-config';

// we need to use an import/require here because it does not force consumers to
// enable esModuleInterop in tsconfig.json
import glob = require('glob');

export const defaultGraphQLProjectName = 'GraphQL';

// temporary utility until `graphql-config` supports this function natively
// see: https://github.com/prisma/graphql-config/pull/113
export function resolvePathRelativeToConfig(
  project: GraphQLProjectConfig,
  relativePath: string,
) {
  return resolve(project.dirpath, relativePath);
}

export function resolveProjectName(
  project: GraphQLProjectConfig,
  defaultName = defaultGraphQLProjectName,
) {
  // eslint-disable-next-line no-console
  console.warn(
    'Deprecation: Use of `resolveProjectName` has been deprecated. Please use `project.name` instead.',
  );
  return project.name || defaultName;
}

export function resolveSchemaPath(
  project: GraphQLProjectConfig,
  ignoreMissing = false,
) {
  // schemaPath is nullable in graphq-config even though it cannot actually be
  // omitted. This function simplifies access to the schemaPath without
  // requiring a type guard.
  if (!project.schema) {
    // this case should never happen with a properly formatted config file.
    // graphql-config currently does not perform any validation so it's possible
    // for a mal-formed schema to be loaded at runtime.
    throw new Error(
      `Missing GraphQL schemaPath for project '${resolveProjectName(project)}'`,
    );
  }

  // resolve fully qualified schemaPath
  const schemaPath = resolve(project.dirpath, project.schema as string);

  if (ignoreMissing) {
    return schemaPath;
  }

  if (!existsSync(schemaPath)) {
    const forProject = project.name ? ` for project '${project.name}'` : '';
    throw new Error(
      [
        `Schema not found${forProject}.`,
        `Expected to find the schema at '${schemaPath}' but the path does not exist.`,
        `Check '${project.filepath}' and verify that schemaPath is configured correctly${forProject}.`,
      ].join(' '),
    );
  }

  return schemaPath;
}

export function getGraphQLProjects(config: GraphQLConfig) {
  if (config.projects) {
    // multi-project configuration, return an array of projects
    return Object.values(config.projects);
  }

  return [config.getProject()];
}

export function getGraphQLSchemaPaths(config: GraphQLConfig) {
  return getGraphQLProjects(config).reduce<string[]>((schemas, project) => {
    return schemas.concat(resolveSchemaPath(project));
  }, []);
}

/**
 * Helper to format a string or array of strings
 * to array of strings
 *
 * @param value an file path or array of paths
 * @returns array of file paths
 */
function toArray(value?: string | string[]) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Get an array of include paths for a project
 *
 * @param projectConfig The current project config
 * @returns Array of include paths
 */
export function getGraphQLProjectInclude(projectConfig: GraphQLProjectConfig) {
  return toArray(projectConfig.include);
}

/**
 * Get an array of exclude paths for a project
 *
 * @param projectConfig The current project config
 * @returns Array of exclude paths
 */
export function getGraphQLProjectExclude(projectConfig: GraphQLProjectConfig) {
  return toArray(projectConfig.include);
}

export async function getGraphQLProjectIncludedFilePaths(
  projectConfig: GraphQLProjectConfig,
) {
  return (
    await Promise.all(
      getGraphQLProjectInclude(projectConfig).map((include) =>
        promisify(glob)(resolvePathRelativeToConfig(projectConfig, include), {
          ignore: getGraphQLProjectExclude(projectConfig).map((exclude) =>
            resolvePathRelativeToConfig(projectConfig, exclude),
          ),
        }),
      ),
    )
  ).reduce((allFilePaths, filePaths) => allFilePaths.concat(filePaths), []);
}

export function getGraphQLProjectForSchemaPath(
  config: GraphQLConfig,
  schemaPath: string,
) {
  const project = config.getProjectForFile(schemaPath) || config.getProject();

  if (!project.match(schemaPath)) {
    throw new Error(
      `No project defined in graphql config for schema '${schemaPath}'`,
    );
  }

  return project;
}

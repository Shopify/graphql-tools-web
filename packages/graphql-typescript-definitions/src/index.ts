import {EventEmitter} from 'events';
import {
  DocumentNode,
  DefinitionNode,
  OperationDefinitionNode,
  parse,
  Source,
  concatAST,
} from 'graphql';
import chalk from 'chalk';
import {dirname, join, resolve} from 'path';
import {readFileSync, writeFileSync, mkdirpSync} from 'fs-extra';
import {FSWatcher, watch} from 'chokidar';
import * as glob from 'glob';
import {
  getGraphQLConfig,
  GraphQLProjectConfig,
  GraphQLConfig,
} from 'graphql-config';
import {
  compile,
  isOperation,
  Operation,
  Fragment,
  AST,
} from 'graphql-tool-utilities/ast';
import {
  getGraphQLFilePath,
  getGraphQLProjectForSchemaPath,
  getGraphQLProjects,
  getGraphQLSchemaPaths,
} from 'graphql-tool-utilities/config';

import {printDocument, printSchema} from './print';
import {EnumFormat} from './types';

export {EnumFormat};

export interface Options {
  addTypename: boolean;
  enumFormat?: EnumFormat;
  schemaTypesPath: string;
}

export interface BuilderOptions extends Options {
  cwd?: string;
}

export interface RunOptions {
  watch?: boolean;
}

export interface SchemaBuild {
  schemaPath: string;
  schemaTypesPath: string;
}

export interface DocumentBuild {
  documentPath: string;
  definitionPath: string;
  operation?: Operation;
  fragments: Fragment[];
}

type GraphQLDocumentMapByProject = Map<
  string | undefined,
  Map<string, DocumentNode>
>;

export class Builder extends EventEmitter {
  private options: Options;
  // workspace graphql configuration
  // see: https://github.com/prisma/graphql-config
  private readonly config: GraphQLConfig;
  // projectName -> {filePath -> document}
  // NOTE: projectName can be undefined for nameless graphql-config projects
  private documentMapByProject: GraphQLDocumentMapByProject = new Map<
    string | undefined,
    Map<string, DocumentNode>
  >();
  private readonly watchers: FSWatcher[] = [];

  constructor({cwd, ...options}: BuilderOptions) {
    super();
    this.options = options;

    this.config = getGraphQLConfig(cwd ? resolve(cwd) : undefined);
  }

  once(event: 'error', handler: (error: Error) => void): this;
  once(event: 'build:docs', handler: (built: DocumentBuild) => void): this;
  once(event: 'build:schema', handler: (built: SchemaBuild) => void): this;
  once(event: 'start:docs', handler: () => void): this;
  once(event: 'end:docs', handler: () => void): this;
  once(event: 'start:schema', handler: () => void): this;
  once(event: 'end:schema', handler: () => void): this;
  once(event: string, handler: (...args: any[]) => void): this {
    return super.once(event, handler);
  }

  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'build:docs', handler: (built: DocumentBuild) => void): this;
  on(event: 'build:schema', handler: (built: SchemaBuild) => void): this;
  on(event: 'start:docs', handler: () => void): this;
  on(event: 'end:docs', handler: () => void): this;
  on(event: 'start:schema', handler: () => void): this;
  on(event: 'end:schema', handler: () => void): this;
  on(event: string, handler: (...args: any[]) => void): this {
    return super.on(event, handler);
  }

  emit(event: 'error', error: Error): boolean;
  emit(event: 'build:docs', built: DocumentBuild): boolean;
  emit(event: 'build:schema', built: SchemaBuild): boolean;
  emit(event: 'start:docs'): boolean;
  emit(event: 'end:docs'): boolean;
  emit(event: 'start:schema'): boolean;
  emit(event: 'end:schema'): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  async run({watch: watchGlobs = false} = {}) {
    const schemaPaths = getGraphQLSchemaPaths(this.config);

    if (watchGlobs) {
      this.watchers.push(
        ...this.setupDocumentWatchers().concat(this.setupSchemaWatcher()),
      );

      // wait for all watchers to be ready
      await Promise.all(
        this.watchers.map(
          (watcher) =>
            new Promise((resolve) => watcher.on('ready', () => resolve())),
        ),
      );
    }

    try {
      this.emit('start:schema');
      schemaPaths.forEach((schemaPath) => this.generateSchemaTypes(schemaPath));
      this.emit('end:schema');
    } catch (error) {
      this.emit('error', error);
      return;
    }

    try {
      getGraphQLProjects(this.config).forEach((projectConfig) =>
        this.updateDocumentsForProject(projectConfig),
      );
    } catch (error) {
      this.emit('error', error);
      return;
    }

    this.generateDocumentTypes();
  }

  stop() {
    this.watchers.forEach((watcher) => {
      watcher.close();
    });

    this.watchers.length = 0;
  }

  private setupDocumentWatchers() {
    const update = (filePath: string, projectConfig: GraphQLProjectConfig) => {
      try {
        this.updateDocumentForFile(filePath, projectConfig);
      } catch (error) {
        this.emit('error', error);
        return;
      }

      this.generateDocumentTypes();
    };

    return getGraphQLProjects(this.config).map((projectConfig) => {
      return watch(
        projectConfig.includes.map((include) =>
          getGraphQLFilePath(this.config, include),
        ),
        {
          ignored: projectConfig.excludes.map((exclude) =>
            getGraphQLFilePath(this.config, exclude),
          ),
          ignoreInitial: true,
        },
      )
        .on('add', (filePath: string) => update(filePath, projectConfig))
        .on('change', (filePath: string) => update(filePath, projectConfig))
        .on('unlink', (filePath: string) => {
          const documents = this.documentMapByProject.get(
            projectConfig.projectName,
          );

          if (documents) {
            documents.delete(filePath);
          }

          this.generateDocumentTypes();
        });
    });
  }

  private setupSchemaWatcher() {
    const update = (schemaPath: string) => {
      try {
        this.emit('start:schema');
        this.generateSchemaTypes(schemaPath);
        this.emit('end:schema');

        this.generateDocumentTypes();
      } catch (error) {
        // intentional noop
      }
    };

    return watch(getGraphQLSchemaPaths(this.config), {ignoreInitial: true}).on(
      'change',
      update,
    );
  }

  private generateSchemaTypes(schemaPath: string) {
    const projectConfig = getGraphQLProjectForSchemaPath(
      this.config,
      schemaPath,
    );

    const schemaTypesPath = getSchemaTypesPath(projectConfig, this.options);
    const definition = printSchema(projectConfig.getSchema(), this.options);
    mkdirpSync(dirname(schemaTypesPath));
    writeFileSync(schemaTypesPath, definition);
    this.emit('build:schema', {
      schemaPath,
      schemaTypesPath,
    });
  }

  private generateDocumentTypes() {
    this.emit('start:docs');

    getDuplicateOperations(this.documentMapByProject).forEach(
      ({projectName, duplicates}) => {
        if (duplicates.length) {
          duplicates.forEach(({operationName, filePaths}) => {
            const message = `GraphQL operations must have a unique name. The operation ${chalk.bold(
              operationName,
            )} is declared in:\n ${filePaths.sort().join('\n ')}${
              projectName ? ` (${chalk.bold(projectName)})` : ''
            }`;

            this.emit('error', new Error(message));
          });
        }
      },
    );

    for (const [
      projectName,
      documents,
    ] of this.documentMapByProject.entries()) {
      this.generateDocumentTypesForProject(
        this.config.getProjectConfig(projectName),
        documents,
      );
    }

    this.emit('end:docs');
  }

  private generateDocumentTypesForProject(
    projectConfig: GraphQLProjectConfig,
    documents: Map<string, DocumentNode>,
  ) {
    let ast: AST;

    try {
      ast = compile(
        projectConfig.getSchema(),
        concatAST(Array.from(documents.values())),
      );
    } catch (error) {
      this.emit('error', error);
      return;
    }

    const fileMap = groupOperationsAndFragmentsByFile(ast);

    try {
      for (const file of fileMap.values()) {
        this.writeDocumentFile(file, ast, projectConfig);
      }
    } catch (error) {
      // intentional noop
    }
  }

  private writeDocumentFile(
    file: File,
    ast: AST,
    project: GraphQLProjectConfig,
  ) {
    const definitionPath = `${file.path}.d.ts`;
    const definition = this.getDocumentDefinition(file, ast, project);

    writeFileSync(definitionPath, definition);

    const result = {
      documentPath: file.path,
      definitionPath,
      operation: file.operation,
      fragments: file.fragments,
    };

    this.emit('build:docs', result);
  }

  private getDocumentDefinition(
    file: File,
    ast: AST,
    project: GraphQLProjectConfig,
  ) {
    try {
      return printDocument(file, ast, {
        ...this.options,
        schemaTypesPath: getSchemaTypesPath(project, this.options),
      });
    } catch ({message}) {
      const error = new Error(
        `Error in ${file.path}: ${message[0].toLowerCase()}${message.slice(1)}`,
      );
      this.emit('error', error);
      throw error;
    }
  }

  private updateDocumentsForProject(projectConfig: GraphQLProjectConfig) {
    return Array.from(
      projectConfig.includes
        .flatMap((include) =>
          glob.sync(getGraphQLFilePath(this.config, include), {
            ignore: projectConfig.excludes.map((exclude) =>
              getGraphQLFilePath(this.config, exclude),
            ),
          }),
        )
        .reduce((filePaths, filePath) => {
          return filePaths.add(filePath);
        }, new Set<string>())
        .values(),
    ).map((filePath) => this.updateDocumentForFile(filePath, projectConfig));
  }

  private updateDocumentForFile(
    filePath: string,
    project: GraphQLProjectConfig,
  ) {
    let documents = this.documentMapByProject.get(project.projectName);

    if (!documents) {
      documents = new Map<string, DocumentNode>();
      this.documentMapByProject.set(project.projectName, documents);
    }

    const contents = readFileSync(filePath, 'utf8');

    if (contents.trim().length === 0) {
      return undefined;
    }

    const document = parse(new Source(contents, filePath));
    documents.set(filePath, document);

    return document;
  }
}

function getSchemaTypesPath(project: GraphQLProjectConfig, options: Options) {
  if (typeof project.extensions.schemaTypesPath === 'string') {
    return getGraphQLFilePath(project, project.extensions.schemaTypesPath);
  }

  return getGraphQLFilePath(
    project,
    join(
      options.schemaTypesPath,
      `${project.projectName ? `${project.projectName}-` : ''}types.ts`,
    ),
  );
}

interface File {
  path: string;
  operation?: Operation;
  fragments: Fragment[];
}

function groupOperationsAndFragmentsByFile({operations, fragments}: AST) {
  return (Object.values(operations) as Array<Operation | Fragment>)
    .concat(Object.values(fragments))
    .reduce((map, item) => {
      if (!item.filePath) {
        return map;
      }

      let file = map.get(item.filePath);

      if (!file) {
        file = {
          path: item.filePath,
          operation: undefined,
          fragments: [],
        };

        map.set(item.filePath, file);
      }

      if (isOperation(item)) {
        file.operation = item;
      } else {
        file.fragments.push(item);
      }

      return map;
    }, new Map<string, File>());
}

function getDuplicateOperations(
  documentsMapByProject: GraphQLDocumentMapByProject,
) {
  return Array.from(documentsMapByProject.entries()).map(
    ([projectName, documents]) => {
      return {
        projectName,
        duplicates: getDuplicateProjectOperations(documents),
      };
    },
  );
}

function getDuplicateProjectOperations(documents: Map<string, DocumentNode>) {
  const operations = new Map<string, Set<string>>();

  Array.from(documents.entries()).forEach(([filePath, document]) => {
    document.definitions.filter(isOperationDefinition).forEach((definition) => {
      const {name} = definition;
      if (name && name.value) {
        const map = operations.get(name.value);
        if (map) {
          map.add(filePath);
        } else {
          operations.set(name.value, new Set([filePath]));
        }
      }
    });
  });

  return Array.from(operations.entries())
    .filter(([, filePaths]) => filePaths.size > 1)
    .map(([operationName, filePath]) => {
      return {operationName, filePaths: Array.from(filePath)};
    });
}

function isOperationDefinition(
  definition: DefinitionNode,
): definition is OperationDefinitionNode {
  return definition.kind === 'OperationDefinition';
}

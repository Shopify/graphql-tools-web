import {EventEmitter} from 'events';
import {
  buildClientSchema,
  GraphQLSchema,
  DocumentNode,
  parse,
  Source,
  concatAST,
} from 'graphql';
import {dirname, basename, extname} from 'path';
import {readJSON, readFile, writeFile, mkdirp} from 'fs-extra';
import {watch} from 'chokidar';
import * as glob from 'glob';
import {compile, Operation, Fragment, AST} from 'graphql-tool-utilities/ast';

import {printDocument, printSchema} from './print';
import {EnumFormat} from './types';

export {EnumFormat};

export interface Options {
  graphQLFiles: string;
  schemaPath: string;
  schemaTypesPath: string;
  addTypename: boolean;
  enumFormat?: EnumFormat;
}

export interface RunOptions {
  watch?: boolean;
}

export interface Build {
  documentPath: string;
  definitionPath: string;
  operation?: Operation;
  fragments: Fragment[];
}

export class Builder extends EventEmitter {
  watching = false;
  private globs: string;
  private schemaPath: string;
  private schema!: GraphQLSchema;
  private options: Pick<
    Options,
    Exclude<keyof Options, 'graphQLFiles' | 'schemaPath'>
  >;
  private documentCache = new Map<string, DocumentNode>();

  constructor({graphQLFiles, schemaPath, ...options}: Options) {
    super();
    this.globs = graphQLFiles;
    this.schemaPath = schemaPath;
    this.options = options;
  }

  once(event: 'error', handler: (error: Error) => void): this;
  once(event: 'build', handler: (built: Build) => void): this;
  once(event: 'start', handler: () => void): this;
  once(event: 'end', handler: () => void): this;
  once(event: 'schema:start', handler: () => void): this;
  once(event: 'schema:end', handler: () => void): this;
  once(event: string, handler: (...args: any[]) => void): this {
    return super.once(event, handler);
  }

  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'build', handler: (built: Build) => void): this;
  on(event: 'start', handler: () => void): this;
  on(event: 'end', handler: () => void): this;
  on(event: 'schema:start', handler: () => void): this;
  on(event: 'schema:end', handler: () => void): this;
  on(event: string, handler: (...args: any[]) => void): this {
    return super.on(event, handler);
  }

  emit(event: 'error', error: Error): boolean;
  emit(event: 'build', built: Build): boolean;
  emit(event: 'start'): boolean;
  emit(event: 'end'): boolean;
  emit(event: 'schema:start'): boolean;
  emit(event: 'schema:end'): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  async run({watch: watchGlobs = false} = {}) {
    this.watching = watchGlobs;

    const {globs} = this;

    const update = async (file: string) => {
      try {
        await this.updateDocumentForFile(file);
      } catch (error) {
        this.emit('error', error);
        return;
      }

      await this.generateDocumentTypes();
    };

    if (watchGlobs) {
      const documentWatcher = watch(globs);
      documentWatcher.on('ready', () => {
        documentWatcher.on('add', update);
        documentWatcher.on('change', update);
        documentWatcher.on('unlink', async (file: string) => {
          this.removeDocumentForFile(file);
          await this.generateDocumentTypes();
        });
      });

      const schemaWatcher = watch(this.schemaPath);
      schemaWatcher.on('ready', () => {
        schemaWatcher.on('change', async () => {
          try {
            await this.updateSchema();
            await this.generateSchemaTypes();
            await this.generateDocumentTypes();
          } catch (error) {
            // intentional noop
          }
        });
      });
    }

    try {
      await this.updateSchema();
      await this.generateSchemaTypes();
    } catch (error) {
      this.emit('error', error);
      return;
    }

    try {
      await Promise.all(
        glob.sync(globs).map(this.updateDocumentForFile.bind(this)),
      );
    } catch (error) {
      this.emit('error', error);
      return;
    }

    await this.generateDocumentTypes();
  }

  private async generateSchemaTypes() {
    this.emit('schema:start');
    const definition = printSchema(this.schema, this.options);
    await mkdirp(dirname(this.options.schemaTypesPath));
    await writeFile(this.options.schemaTypesPath, definition);
    this.emit('schema:end');
  }

  private async generateDocumentTypes() {
    this.emit('start');
    let ast: AST;

    try {
      ast = compile(
        this.schema,
        concatAST(Array.from(this.documentCache.values())),
      );
    } catch (error) {
      this.emit('error', error);
      return;
    }

    const fileMap = groupOperationsAndFragmentsByFile(ast);

    try {
      const buildResults = await Promise.all(
        Object.keys(fileMap).map(async (key) => {
          const file = fileMap[key];
          const {operation} = file;

          let definition: string;

          if (operation && checkFileNameMismatch(file)) {
            const {operationName} = operation;
            const expectedFileName = getExpectedFileNameFromOperation(
              operation,
            );

            const error = new Error(
              `Error in ${
                file.path
              }: Operation name and type do not match file's name. Expected file ${expectedFileName} to contain ${operationName}.`,
            );
            this.emit('error', error);
            throw error;
          }

          try {
            definition = printDocument(file, ast, this.options);
          } catch ({message}) {
            const error = new Error(
              `Error in ${
                file.path
              }: ${message[0].toLowerCase()}${message.slice(1)}`,
            );
            this.emit('error', error);
            throw error;
          }

          const definitionPath = `${file.path}.d.ts`;
          await writeFile(definitionPath, definition);

          return {
            documentPath: file.path,
            definitionPath,
            operation: file.operation,
            fragments: file.fragments,
          };
        }),
      );

      for (const buildResult of buildResults) {
        this.emit('build', buildResult);
      }
    } catch (error) {
      return;
    }

    this.emit('end');
  }

  private async updateSchema() {
    try {
      const schemaJSON = await readJSON(this.schemaPath);
      this.schema = buildClientSchema(schemaJSON.data);
    } catch (error) {
      const parseError = new Error(
        `Error parsing '${this.schemaPath}':\n\n${error.message.replace(
          /Syntax Error GraphQL \(.*?\) /,
          '',
        )}`,
      );
      throw parseError;
    }
  }

  private async updateDocumentForFile(file: string) {
    const contents = await readFile(file, 'utf8');
    if (contents.trim().length === 0) {
      return;
    }

    const document = parse(new Source(contents, file));
    this.documentCache.set(file, document);
  }

  private removeDocumentForFile(file: string) {
    this.documentCache.delete(file);
  }
}

interface File {
  path: string;
  operation?: Operation;
  fragments: Fragment[];
}

interface FileMap {
  [key: string]: File;
}

function groupOperationsAndFragmentsByFile({
  operations,
  fragments,
}: AST): FileMap {
  const map: FileMap = {};

  Object.keys(operations).forEach((name) => {
    const operation = operations[name];
    const file = map[operation.filePath] || {
      path: operation.filePath,
      operation,
      fragments: [],
    };
    map[operation.filePath] = file;
  });

  Object.keys(fragments).forEach((name) => {
    const fragment = fragments[name];
    const file = map[fragment.filePath] || {
      path: fragment.filePath,
      operation: undefined,
      fragments: [],
    };
    file.fragments.push(fragment);
    map[fragment.filePath] = file;
  });

  return map;
}

function getFileNameFromPath(path: string) {
  const fileName = basename(path);
  const fileExtension = extname(path);
  const extensionLength = fileExtension.length;

  return fileName.slice(0, -extensionLength);
}

function checkFileNameMismatch(file: File) {
  const {operation} = file;

  if (!operation) {
    return false;
  }

  const {filePath, operationName, operationType} = operation;
  const fileName = getFileNameFromPath(filePath);
  const type = toCapitalized(operationType);

  return fileName !== `${operationName}${type}`;
}

function getExpectedFileNameFromOperation(operation: Operation) {
  const {operationName, operationType, filePath} = operation;
  return `${operationName}${toCapitalized(operationType)}${extname(filePath)}`;
}

function toCapitalized(str: string) {
  return str.charAt(0).toUpperCase() + str.substr(1);
}

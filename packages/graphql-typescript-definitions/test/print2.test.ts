import * as path from 'path';
import {buildSchema, parse, GraphQLSchema, Source, concatAST} from 'graphql';
import {stripIndent} from 'common-tags';
import {compile} from 'graphql-tool-utilities/ast';

import {printFile, Options} from '../src/print2';

describe('printFile()', () => {
  describe('scalars', () => {
    it('prints a string type', () => {
      const schema = buildSchema(`
        type Query {
          firstName: String!
          lastName: String
        }
      `);

      expect(print('query Details { firstName, lastName }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            firstName: string;
            lastName?: string | null;
          }
        `);
    });

    it('prints an integer type', () => {
      const schema = buildSchema(`
        type Query {
          age: Int!
          jerseyNumber: Int
        }
      `);

      expect(print('query Details { age, jerseyNumber }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            age: number;
            jerseyNumber?: number | null;
          }
        `);
    });

    it('prints a float type', () => {
      const schema = buildSchema(`
        type Query {
          weight: Float!
          pantSize: Float
        }
      `);

      expect(print('query Details { weight, pantSize }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            weight: number;
            pantSize?: number | null;
          }
        `);
    });

    it('prints a boolean type', () => {
      const schema = buildSchema(`
        type Query {
          married: Boolean!
          deterministic: Boolean
        }
      `);

      expect(print('query Details { married, deterministic }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            married: boolean;
            deterministic?: boolean | null;
          }
        `);
    });

    it('prints an ID type', () => {
      const schema = buildSchema(`
        type Query {
          sin: ID!
          driversLicense: ID
        }
      `);

      expect(print('query Details { sin, driversLicense }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            sin: string;
            driversLicense?: string | null;
          }
        `);
    });
  });

  describe('custom scalars', () => {
    it('prints a custom scalar type', () => {
      const schema = buildSchema(`
        scalar Date

        type Query {
          dateOfBirth: Date
        }
      `);

      expect(print('query Details { dateOfBirth }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            dateOfBirth?: Date | null;
          }
        `);
    });

    it('imports the scalar from the schema types file', () => {
      const filename = path.resolve('DetailsQuery.graphql');
      const schemaTypesPath = path.resolve('Schema.ts');
      const schema = buildSchema(`
        scalar Date

        type Query {
          dateOfBirth: Date
        }
      `);

      expect(
        print('query Details { dateOfBirth }', schema, {
          filename,
          printOptions: {schemaTypesPath},
        }),
      ).toContain(stripIndent`
        import { Date } from "${expectedImportPath(filename, schemaTypesPath)}";
      `);
    });
  });

  describe('enums', () => {
    it('prints an enum type', () => {
      const schema = buildSchema(`
        enum Faction {
          EMPIRE
          REBELS
        }

        type Query {
          faction: Faction!
        }
      `);

      expect(print('query Details { faction }', schema)).toContain(stripIndent`
        export interface DetailsQueryData {
          faction: Faction;
        }
      `);
    });

    it('imports the enum from the schema types file', () => {
      const filename = path.resolve('DetailsQuery.graphql');
      const schemaTypesPath = path.resolve('Schema.ts');
      const schema = buildSchema(`
        enum Faction {
          EMPIRE
          REBELS
        }

        type Query {
          faction: Faction!
        }
      `);

      expect(
        print('query Details { faction }', schema, {
          filename,
          printOptions: {schemaTypesPath},
        }),
      ).toContain(stripIndent`
        import { Faction } from "${expectedImportPath(
          filename,
          schemaTypesPath,
        )}";
      `);
    });
  });

  describe('lists', () => {
    it('prints list types with non-null members', () => {
      const schema = buildSchema(`
        type Query {
          listOne: [String!]!
          listTwo: [String!]
        }
      `);

      expect(print('query Details { listOne, listTwo }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            listOne: string[];
            listTwo?: string[] | null;
          }
        `);
    });

    it('prints list types with nullable members', () => {
      const schema = buildSchema(`
        type Query {
          listOne: [String]!
          listTwo: [String]
        }
      `);

      expect(print('query Details { listOne, listTwo }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            listOne: (string | null)[];
            listTwo?: (string | null)[] | null;
          }
        `);
    });

    it('prints nested lists', () => {
      const schema = buildSchema(`
        type Query {
          listOne: [[String!]]!
          listTwo: [[String]]
        }
      `);

      expect(print('query Details { listOne, listTwo }', schema))
        .toContain(stripIndent`
          export interface DetailsQueryData {
            listOne: (string[] | null)[];
            listTwo?: ((string | null)[] | null)[] | null;
          }
        `);
    });
  });

  describe('objects', () => {
    it('does not export a namespace when there are no nested objects', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(print('query Details { name }', schema)).not.toContain(
        'export namespace DetailsQueryData',
      );
    });

    it('prints a nested object', () => {
      const schema = buildSchema(`
        type Person {
          name: String!
          age: Int!
        }

        type Query {
          self: Person!
          partner: Person
        }
      `);

      expect(
        print(
          `
          query Details {
            self { name }
            partner { age }
          }
          `,
          schema,
        ),
      ).toContain(stripIndent`
        export namespace DetailsQueryData {
          export interface SelfPerson {
            name: string;
          }
          export interface PartnerPerson {
            age: number;
          }
        }
        export interface DetailsQueryData {
          self: SelfPerson;
          partner?: PartnerPerson | null;
        }
      `);
    });

    it('prints a deeply nested object', () => {
      const schema = buildSchema(`
        type Person {
          name: String!
          partner: Person
        }

        type Query {
          self: Person!
        }
      `);

      expect(
        print(
          `
          query Details {
            self { partner { name } }
          }
          `,
          schema,
        ),
      ).toContain(stripIndent`
        export namespace DetailsQueryData {
          export interface SelfPartnerPerson {
            name: string;
          }
          export interface SelfPerson {
            partner?: SelfPartnerPerson | null;
          }
        }
        export interface DetailsQueryData {
          self: SelfPerson;
        }
      `);
    });

    it('prints a deeply nested object with alias field names', () => {
      const schema = buildSchema(`
        type Person {
          name: String!
          partner: Person
        }

        type Query {
          self: Person!
        }
      `);

      expect(
        print(
          `
          query Details {
            self {
              partner { nom: name }
              wife: partner { name }
            }
          }
          `,
          schema,
        ),
      ).toContain(stripIndent`
        export namespace DetailsQueryData {
          export interface SelfPartnerPerson {
            nom: string;
          }
          export interface SelfWifePerson {
            name: string;
          }
          export interface SelfPerson {
            partner?: SelfPartnerPerson | null;
            wife?: SelfWifePerson | null;
          }
        }
        export interface DetailsQueryData {
          self: SelfPerson;
        }
      `);
    });
  });

  describe('directives', () => {
    it('makes a non-null field optional when it has the include directive', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(
        print(
          'query Details($condition: Bool!) { name @include(if: $condition) }',
          schema,
        ),
      ).toContain(stripIndent`
        export interface DetailsQueryData {
          name?: string | null;
        }
      `);
    });

    it('makes a non-null field optional when it has the skip directive', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(
        print(
          'query Details($condition: Bool!) { name @skip(if: $condition) }',
          schema,
        ),
      ).toContain(stripIndent`
        export interface DetailsQueryData {
          name?: string | null;
        }
      `);
    });

    it('does not change field typings for other directives', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(
        print('query Details($baz: Bool!) { name @foo(bar: $baz) }', schema),
      ).toContain(stripIndent`
        export interface DetailsQueryData {
          name: string;
        }
      `);
    });
  });

  describe('document', () => {
    it('imports DocumentNode from graphql-typed', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(print('query Details { name }', schema)).toContain(
        'import { DocumentNode } from "graphql-typed";',
      );
    });

    it('exports a DocumentNode as the default export with the operation data type annotation', () => {
      const schema = buildSchema(`
        type Query {
          name: String!
        }
      `);

      expect(print('query Details { name }', schema)).toContain(stripIndent`
        declare const document: DocumentNode<DetailsQueryData>;
        export default document;
      `);
    });
  });
});

function expectedImportPath(from: string, to: string) {
  const relative = path.relative(path.dirname(from), to);
  return relative.startsWith('..') ? relative : `./${relative}`;
}

interface TestOptions {
  fragments?: {[key: string]: string};
  filename?: string;
  printOptions?: Options;
}

function print(
  documentString: string,
  schema: GraphQLSchema,
  {
    fragments = {},
    filename = path.resolve('MyOperation.graphql'),
    printOptions = {},
  }: TestOptions = {},
) {
  const finalOptions = {
    addTypename: true,
    schemaTypesPath: path.resolve('Schema.ts'),
    ...printOptions,
  };
  const fragmentDocuments = Object.keys(fragments).map((key) =>
    parse(new Source(fragments[key], key)),
  );
  const document = parse(new Source(documentString, filename));
  const ast = compile(schema, concatAST([document, ...fragmentDocuments]));
  const file = {
    path: filename,
    operations: Object.keys(ast.operations)
      .map((key) => ast.operations[key])
      .filter((operation) => operation.filePath === filename),
    fragments: Object.keys(ast.fragments)
      .map((key) => ast.fragments[key])
      .filter((fragment) => fragment.filePath === filename),
  };
  return printFile(file, ast, finalOptions);
}

# `graphql-validate-fixtures`

> Validates JSON fixtures for GraphQL responses against the associated operations and schema

## Installation

```
npm install graphql-validate-fixtures --save-dev
```

or, with Yarn:

```
yarn add graphql-validate-fixtures --dev
```

## Usage

In order to associate a fixture with a GraphQL query or mutation in your app, you must follow one of these conventions:

* Your fixtures are in a directory with a name matching that of the associated GraphQL operation
* Your fixtures have a key called `@operation` at the top level, which has a string value that is the name of the associated operation

Once this is done, you can validate your fixtures using the CLI or Node.js API.

### Configuration

This tool reads schema information from a [`.graphqlconfig`](https://github.com/prisma/graphql-config) file in the project root. The configuration can contain one nameless project or many named projects. The configuration is compatible with the [vscode-graphql extension](https://github.com/prisma/vscode-graphql). This extension provides syntax highlighting and autocomplete suggestions for graphql files.

Each project specifies a `schemaPath`, `include`, and `exclude` globs. Glob patterns match paths relative to the location of the configuration file. Omit `exclude` if empty.

On startup this tool performs the following actions:

* Loads all schemas
* Discovers all operations belonging to each schema
* Discovers all fixtures and infers operation names as described [above](#Usage)
* Validates fixtures against the operation with a matching name
  * Reports operation not found error if no schema matches
  * Reports ambiguous operation name error if more than one schema matches

See the [official specification documentation](https://github.com/prisma/graphql-config/blob/master/specification.md#use-cases) for more detail and examples.

#### Examples

A single nameless project configuration

```json
{
  "schemaPath": "build/schema.json",
  "includes": "app/**/*.graphql"
}
```

A multi-project configuration

```json
{
  "projects": {
    "foo": {
      "schemaPath": "build/schema/foo.json",
      "includes": "app/foo/**/*.graphql"
    },
    "bar": {
      "schemaPath": "build/schema/bar.json",
      "includes": "app/bar/**/*.graphql"
    }
  }
}
```

A project configuration with a `schemaTypesPath` override

```json
{
  "projects": {
    "foo": {
      "schemaPath": "build/schema/foo.json",
      "includes": "app/foo/**/*.graphql"
    },
    "bar": {
      "schemaPath": "build/schema/bar.json",
      "includes": "app/bar/**/*.graphql",
      "extensions": {
        "schemaTypesPath": "app/bar/types/graphql.ts"
      }
    }
  }
}
```

### CLI

```sh
# Must provide a list of fixtures as the first argument
yarn run graphql-validate-fixtures 'src/**/fixtures/**/*.graphql.json'
```

### Node

```js
const {evaluateFixtures} = require('graphql-validate-fixtures');
evaluateFixtures({
  fixturePaths: ['test/fixtures/one.json', 'test/fixtures/two.json'],
}).then((results) => {
  // See the TypeScript definition file for more details on the
  // structure of the `results`
  results.forEach((result) => console.log(result));
});
```

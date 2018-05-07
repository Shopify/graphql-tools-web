import './polyfills';
import {
  GraphQLSchema,
  DocumentNode,
  GraphQLType,
  GraphQLOutputType,
  GraphQLInputType,
  GraphQLInterfaceType,
  GraphQLObjectType,
} from 'graphql';

const {
  compileToLegacyIR: compileToIR,
} = require('apollo-codegen/lib/compiler/legacyIR');

export interface Variable {
  name: string;
  type?: GraphQLInputType;
}

export interface TypedVariable {
  name: string;
  type: GraphQLInputType;
}

export interface Condition {
  kind: string;
  variableName: string;
  inverted: boolean;
}

export interface PrintableFieldDetails {
  fields?: Field[];
  fragmentSpreads?: string[];
  inlineFragments?: InlineFragment[];
}

export interface Field extends PrintableFieldDetails {
  responseName: string;
  fieldName: string;
  type: GraphQLOutputType;
  isConditional: boolean;
  conditions?: Condition[];
}

export interface InlineFragment extends PrintableFieldDetails {
  typeCondition: GraphQLObjectType | GraphQLInterfaceType;
  possibleTypes: (GraphQLObjectType | GraphQLInterfaceType)[];
}

export interface Fragment extends InlineFragment {
  filePath: string;
  fragmentName: string;
  source: string;
  fields: Field[];
}

export interface Operation {
  filePath: string;
  operationName: string;
  operationType: 'query' | 'mutation' | 'subscription';
  variables: Variable[];
  fields: Field[];
  fragmentsReferenced: string[];
  fragmentSpreads?: string[];
}

export interface AST {
  operations: {[key: string]: Operation};
  fragments: {[key: string]: Fragment};
  typesUsed: GraphQLType[];
  schema: GraphQLSchema;
}

export interface Compile {
  (schema: GraphQLSchema, document: DocumentNode): AST;
}

export const compile: Compile = compileToIR;

import * as t from '@babel/types';
import {relative, dirname} from 'path';
import {ucFirst} from 'change-case';
import {
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLID,
  GraphQLObjectType,
  GraphQLInputType,
  isEnumType,
  isObjectType,
  isNonNullType,
  isScalarType,
  isListType,
  GraphQLType,
  isInputObjectType,
} from 'graphql';
import generate from '@babel/generator';
import {
  Operation,
  Fragment,
  AST,
  Field,
  Variable,
} from 'graphql-tool-utilities/ast';
import {nullLiteral} from '@babel/types';

export interface File {
  path: string;
  operations: Operation[];
  fragments: Fragment[];
}

export interface Options {
  schemaTypesPath: string;
  addTypename?: boolean;
}

const scalarTypeMap = {
  [GraphQLString.name]: t.tsStringKeyword(),
  [GraphQLInt.name]: t.tsNumberKeyword(),
  [GraphQLFloat.name]: t.tsNumberKeyword(),
  [GraphQLBoolean.name]: t.tsBooleanKeyword(),
  [GraphQLID.name]: t.tsStringKeyword(),
};

export function printFile(
  {operations, fragments, path}: File,
  ast: AST,
  options: Options,
) {
  const {schemaTypesPath} = options;
  const operation = operations[0];
  const {operationName, operationType, fields} = operation;

  const context = new OperationContext(options);
  const type = ast.schema.getQueryType();

  const body = fields.map((field) =>
    tsPropertyForField(
      field,
      undefined,
      new ObjectStack(type as any, []),
      context,
    ),
  );

  const operationTypeName = `${ucFirst(operationName)}${ucFirst(
    operationType,
  )}Data`;

  const operationInterface = t.tsInterfaceDeclaration(
    t.identifier(operationTypeName),
    null,
    null,
    t.tsInterfaceBody(body),
  );

  const variables =
    operation.variables.length > 0
      ? t.exportNamedDeclaration(
          variablesInterface(operation.variables, context),
          [],
        )
      : null;

  const {imported, exported} = context;

  const exportedStatements = exported.map((type) =>
    t.exportNamedDeclaration(type, []),
  );

  const namespace =
    exported.length > 0 || variables != null
      ? t.tsModuleDeclaration(
          t.identifier(operationTypeName),
          t.tsModuleBlock(
            variables ? [variables, ...exportedStatements] : exportedStatements,
          ),
        )
      : null;

  const importFromSchema =
    imported.length > 0
      ? t.importDeclaration(
          imported.map((type) =>
            t.importSpecifier(t.identifier(type), t.identifier(type)),
          ),
          t.stringLiteral(importPath(path, schemaTypesPath)),
        )
      : null;

  const documentNodeImport = t.importDeclaration(
    [
      t.importSpecifier(
        t.identifier('DocumentNode'),
        t.identifier('DocumentNode'),
      ),
    ],
    t.stringLiteral('graphql-typed'),
  );

  const documentNodeDeclaratorIdentifier = t.identifier('document');
  documentNodeDeclaratorIdentifier.typeAnnotation = t.tsTypeAnnotation(
    t.tsTypeReference(
      t.identifier('DocumentNode'),
      t.tsTypeParameterInstantiation([
        t.tsTypeReference(t.identifier(operationTypeName)),
      ]),
    ),
  );

  const documentNodeDeclaration = t.variableDeclaration('const', [
    t.variableDeclarator(documentNodeDeclaratorIdentifier),
  ]);

  documentNodeDeclaration.declare = true;

  const documentNodeExport = t.exportDefaultDeclaration(
    t.identifier('document'),
  );

  const fileBody: t.Statement[] = [documentNodeImport];

  if (importFromSchema) {
    fileBody.push(importFromSchema);
  }

  if (namespace) {
    fileBody.push(t.exportNamedDeclaration(namespace, []));
  }

  fileBody.push(
    t.exportNamedDeclaration(operationInterface, []),
    documentNodeDeclaration,
    documentNodeExport,
  );

  const file = t.file(t.program(fileBody), [], []);

  return generate(file).code;
}

function tsInterfaceForObjectField(
  {fields = []}: Field,
  graphQLType: GraphQLObjectType,
  stack: ObjectStack,
  context: OperationContext,
) {
  const uniqueFields = fields.filter((field) => {
    if (stack.hasSeenField(field)) {
      return false;
    }

    stack.sawField(field);
    return true;
  });

  const typenameField = {
    fieldName: '__typename',
    responseName: '__typename',
    type: GraphQLString,
    isConditional: false,
  };

  const typename =
    context.options.addTypename && !stack.hasSeenField(typenameField)
      ? tsPropertyForField(typenameField, graphQLType, stack, context)
      : null;

  const body = uniqueFields.map((field) =>
    tsPropertyForField(field, graphQLType, stack, context),
  );

  return t.tsInterfaceDeclaration(
    t.identifier(stack.name),
    null,
    null,
    t.tsInterfaceBody(typename ? [typename, ...body] : body),
  );
}

function tsPropertyForField(
  field: Field,
  parentType: GraphQLObjectType | undefined,
  stack: ObjectStack,
  context: OperationContext,
) {
  if (field.fieldName === '__typename' && parentType) {
    const typenameProperty = t.tsPropertySignature(
      t.identifier(field.responseName),
      t.tsTypeAnnotation(t.tsLiteralType(t.stringLiteral(parentType.name))),
    );

    typenameProperty.optional = field.isConditional;
    return typenameProperty;
  }

  const property = t.tsPropertySignature(
    t.identifier(field.responseName),
    t.tsTypeAnnotation(tsTypeForGraphQLType(field.type, field, stack, context)),
  );

  property.optional = field.isConditional || !isNonNullType(field.type);

  return property;
}

function tsTypeForGraphQLType(
  graphQLType: GraphQLType,
  field: Field,
  stack: ObjectStack,
  context: OperationContext,
) {
  let type: t.TSType;
  const forceNullable = field.isConditional && graphQLType === field.type;
  const isNonNull = !forceNullable && isNonNullType(graphQLType);
  const unwrapedGraphQLType: GraphQLType = isNonNullType(graphQLType)
    ? graphQLType.ofType
    : graphQLType;

  if (isScalarType(unwrapedGraphQLType)) {
    if (scalarTypeMap.hasOwnProperty(unwrapedGraphQLType.name)) {
      type = scalarTypeMap[unwrapedGraphQLType.name];
    } else {
      context.import(unwrapedGraphQLType.name);
      type = t.tsTypeReference(t.identifier(unwrapedGraphQLType.name));
    }
  } else if (isEnumType(unwrapedGraphQLType)) {
    context.import(unwrapedGraphQLType.name);
    type = t.tsTypeReference(t.identifier(unwrapedGraphQLType.name));
  } else if (isListType(unwrapedGraphQLType)) {
    const {ofType} = unwrapedGraphQLType;
    const arrayType = tsTypeForGraphQLType(ofType, field, stack, context);
    type = t.tsArrayType(
      isNonNullType(ofType) ? arrayType : t.tsParenthesizedType(arrayType),
    );
  } else if (isObjectType(unwrapedGraphQLType)) {
    const objectInterface = tsInterfaceForObjectField(
      field,
      unwrapedGraphQLType,
      stack.nested(field, unwrapedGraphQLType),
      context,
    );
    context.export(objectInterface);
    type = t.tsTypeReference(t.identifier(objectInterface.id.name));
  } else {
    type = t.tsAnyKeyword();
  }

  return isNonNull ? type : t.tsUnionType([type, t.tsNullKeyword()]);
}

function importPath(from: string, to: string) {
  const relativePath = relative(dirname(from), to);
  return relativePath.startsWith('..') ? relativePath : `./${relativePath}`;
}

type NamespaceExportableType =
  | t.TSInterfaceDeclaration
  | t.TSTypeAliasDeclaration;

class OperationContext {
  get exported() {
    return this.exportedTypes;
  }

  get imported() {
    return [...this.importedTypes];
  }

  private exportedTypes: NamespaceExportableType[] = [];
  private importedTypes = new Set<string>();

  constructor(public options: Options) {}

  export(type: NamespaceExportableType) {
    this.exportedTypes.push(type);
  }

  import(type: string) {
    this.importedTypes.add(type);
  }
}

class ObjectStack {
  private seenFields = new Set<string>();

  get name() {
    return (
      this.parentFields
        .map(({responseName}) => ucFirst(responseName))
        .join('') + ucFirst(this.type.name)
    );
  }

  constructor(
    private type: GraphQLObjectType,
    private parentFields: Field[] = [],
  ) {}

  nested(field: Field, type: GraphQLObjectType) {
    return new ObjectStack(type, [...this.parentFields, field]);
  }

  sawField(field: Field) {
    this.seenFields.add(field.responseName);
  }

  hasSeenField(field: Field) {
    return this.seenFields.has(field.responseName);
  }
}

function variablesInterface(variables: Variable[], context: OperationContext) {
  return t.tsInterfaceDeclaration(
    t.identifier('Variables'),
    null,
    null,
    t.tsInterfaceBody(
      variables.map((variable) => tsPropertyForVariable(variable, context)),
    ),
  );
}

function tsPropertyForVariable(
  {name, type}: Variable,
  context: OperationContext,
) {
  const property = t.tsPropertySignature(
    t.identifier(name),
    t.tsTypeAnnotation(tsTypeForGraphQLInputType(type, context)),
  );

  property.optional = !isNonNullType(type);
  return property;
}

function tsTypeForGraphQLInputType(
  graphQLType: GraphQLInputType,
  context: OperationContext,
) {
  let type: t.TSType;

  const unwrapedGraphQLType = isNonNullType(graphQLType)
    ? graphQLType.ofType
    : graphQLType;

  if (isScalarType(unwrapedGraphQLType)) {
    if (scalarTypeMap.hasOwnProperty(unwrapedGraphQLType.name)) {
      type = scalarTypeMap[unwrapedGraphQLType.name];
    } else {
      context.import(unwrapedGraphQLType.name);
      type = t.tsTypeReference(t.identifier(unwrapedGraphQLType.name));
    }
  } else if (
    isEnumType(unwrapedGraphQLType) ||
    isInputObjectType(unwrapedGraphQLType)
  ) {
    context.import(unwrapedGraphQLType.name);
    type = t.tsTypeReference(t.identifier(unwrapedGraphQLType.name));
  } else {
    const {ofType} = unwrapedGraphQLType;
    const arrayType = tsTypeForGraphQLInputType(ofType, context);
    type = t.tsArrayType(
      isNonNullType(ofType) ? arrayType : t.tsParenthesizedType(arrayType),
    );
  }

  return isNonNullType(graphQLType)
    ? type
    : t.tsUnionType([type, t.tsNullKeyword()]);
}

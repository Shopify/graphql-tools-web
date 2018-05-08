import * as t from '@babel/types';
import {relative, dirname} from 'path';
import {ucFirst} from 'change-case';
import {
  GraphQLString,
  GraphQLInputType,
  isEnumType,
  isObjectType,
  isNonNullType,
  isScalarType,
  isListType,
  GraphQLType,
  isInputObjectType,
  isInterfaceType,
  isUnionType,
  GraphQLCompositeType,
  GraphQLObjectType,
} from 'graphql';
import {
  OperationType,
  Operation,
  Fragment,
  AST,
  Field,
  TypedVariable,
  Variable,
  InlineFragment,
  PrintableFieldDetails,
} from 'graphql-tool-utilities/ast';

import {scalarTypeMap} from '../utilities';

const generate = require('@babel/generator').default;

export interface File {
  path: string;
  operation?: Operation;
  fragments: Fragment[];
}

export interface Options {
  schemaTypesPath: string;
  addTypename?: boolean;
}

export function printDocument(
  {operation, path}: File,
  ast: AST,
  options: Options,
) {
  if (operation == null) {
    return '';
  }

  const {schemaTypesPath} = options;

  const context = new OperationContext(operation, ast, options);

  let rootType: GraphQLObjectType;

  if (operation.operationType === OperationType.Query) {
    rootType = ast.schema.getQueryType() as any;
  } else if (operation.operationType === OperationType.Mutation) {
    rootType = ast.schema.getMutationType() as any;
  } else {
    rootType = ast.schema.getSubscriptionType() as any;
  }

  const variables =
    operation.variables.filter(isTypedVariable).length > 0
      ? context.export(variablesInterface(operation.variables, context))
      : null;

  const operationInterface = t.tsInterfaceDeclaration(
    t.identifier(context.typeName),
    null,
    null,
    tsInterfaceBodyForObjectField(
      operation,
      rootType,
      new ObjectStack(rootType, []),
      context,
    ),
  );

  const {imported, exported} = context;

  const namespace =
    exported.length > 0
      ? t.tsModuleDeclaration(
          t.identifier(context.typeName),
          t.tsModuleBlock(
            exported.map((type) => t.exportNamedDeclaration(type, [])),
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
        t.tsTypeReference(t.identifier(context.typeName)),
        variables || t.tsNeverKeyword(),
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

function tsInterfaceBodyForObjectField(
  {fields = []}: PrintableFieldDetails,
  graphQLType: GraphQLCompositeType | GraphQLCompositeType[],
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

  return t.tsInterfaceBody(typename ? [typename, ...body] : body);
}

function tsTypeForInlineFragment(
  inlineFragment: InlineFragment,
  _graphQLType: GraphQLCompositeType,
  stack: ObjectStack,
  context: OperationContext,
) {
  const {typeCondition} = inlineFragment;
  const interfaceDeclaration = t.tsInterfaceDeclaration(
    t.identifier(`${stack.name}${typeCondition.name}`),
    null,
    null,
    tsInterfaceBodyForObjectField(
      inlineFragment,
      typeCondition,
      stack,
      context,
    ),
  );

  return context.export(interfaceDeclaration);
}

function tsTypeForObjectField(
  field: Field,
  graphQLType: GraphQLCompositeType,
  stack: ObjectStack,
  context: OperationContext,
) {
  const {inlineFragments = []} = field;

  if (inlineFragments.length) {
    const fragmentTypes = inlineFragments.map((inlineFragment) =>
      tsTypeForInlineFragment(
        inlineFragment,
        graphQLType,
        stack.fragment(inlineFragment.typeCondition),
        context,
      ),
    );

    const typesCoveredByInlineFragments = new Set(
      inlineFragments.reduce<GraphQLType[]>(
        (types, inlineFragment) => [...types, ...inlineFragment.possibleTypes],
        [],
      ),
    );
    const missingPossibleTypes =
      isInterfaceType(graphQLType) || isUnionType(graphQLType)
        ? context.ast.schema
            .getPossibleTypes(graphQLType)
            .filter((possibleType) => {
              return !typesCoveredByInlineFragments.has(possibleType);
            })
        : [];

    let otherType: t.TSType | null = null;

    if (missingPossibleTypes.length > 0) {
      const otherTypeInterface = t.tsInterfaceDeclaration(
        t.identifier(`${stack.name}Other`),
        null,
        null,
        tsInterfaceBodyForObjectField(
          field,
          missingPossibleTypes,
          stack,
          context,
        ),
      );

      otherType = context.export(otherTypeInterface);
    }

    return t.tsUnionType(
      otherType ? [...fragmentTypes, otherType] : fragmentTypes,
    );
  }

  const interfaceDeclaration = t.tsInterfaceDeclaration(
    t.identifier(stack.name),
    null,
    null,
    tsInterfaceBodyForObjectField(field, graphQLType, stack, context),
  );

  return context.export(interfaceDeclaration);
}

function tsTypenameForGraphQLType(type: GraphQLCompositeType) {
  return t.tsLiteralType(t.stringLiteral(type.name));
}

function tsPropertyForField(
  field: Field,
  parentType: GraphQLCompositeType | GraphQLCompositeType[],
  stack: ObjectStack,
  context: OperationContext,
) {
  if (field.fieldName === '__typename' && parentType) {
    const typename = Array.isArray(parentType)
      ? t.tsUnionType(parentType.map(tsTypenameForGraphQLType))
      : tsTypenameForGraphQLType(parentType);

    const typenameProperty = t.tsPropertySignature(
      t.identifier(field.responseName),
      t.tsTypeAnnotation(typename),
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
  const unwrappedGraphQLType: GraphQLType = isNonNullType(graphQLType)
    ? graphQLType.ofType
    : graphQLType;

  if (isScalarType(unwrappedGraphQLType)) {
    if (scalarTypeMap.hasOwnProperty(unwrappedGraphQLType.name)) {
      type = scalarTypeMap[unwrappedGraphQLType.name];
    } else {
      context.import(unwrappedGraphQLType.name);
      type = t.tsTypeReference(t.identifier(unwrappedGraphQLType.name));
    }
  } else if (isEnumType(unwrappedGraphQLType)) {
    context.import(unwrappedGraphQLType.name);
    type = t.tsTypeReference(t.identifier(unwrappedGraphQLType.name));
  } else if (isListType(unwrappedGraphQLType)) {
    const {ofType} = unwrappedGraphQLType;
    const arrayType = tsTypeForGraphQLType(ofType, field, stack, context);
    type = t.tsArrayType(
      t.isTSUnionType(arrayType) ? t.tsParenthesizedType(arrayType) : arrayType,
    );
  } else if (
    isObjectType(unwrappedGraphQLType) ||
    isInterfaceType(unwrappedGraphQLType) ||
    isUnionType(unwrappedGraphQLType)
  ) {
    type = tsTypeForObjectField(
      field,
      unwrappedGraphQLType,
      stack.nested(field, unwrappedGraphQLType),
      context,
    );
  } else {
    type = t.tsAnyKeyword();
  }

  return isNonNull ? type : t.tsUnionType([type, t.tsNullKeyword()]);
}

function importPath(from: string, to: string) {
  const relativePath = relative(dirname(from), to);
  const normalizedPath = relativePath.startsWith('..')
    ? relativePath
    : `./${relativePath}`;
  return normalizedPath.replace(/\.ts$/, '');
}

type NamespaceExportableType = t.TSInterfaceDeclaration;

class OperationContext {
  get typeName() {
    const {operationName, operationType} = this.operation;
    return `${ucFirst(operationName)}${ucFirst(operationType)}Data`;
  }

  get exported() {
    return this.exportedTypes;
  }

  get imported() {
    return [...this.importedTypes];
  }

  private exportedTypes: NamespaceExportableType[] = [];
  private importedTypes = new Set<string>();

  constructor(
    public operation: Operation,
    public ast: AST,
    public options: Options,
  ) {}

  export(type: NamespaceExportableType) {
    this.exportedTypes.push(type);

    return t.tsTypeReference(
      t.tsQualifiedName(
        t.identifier(this.typeName),
        t.identifier(type.id.name),
      ),
    );
  }

  import(type: string) {
    this.importedTypes.add(type);
  }
}

class ObjectStack {
  private seenFields = new Set<string>();

  get name() {
    return this.parentFields
      .map(({responseName}) => ucFirst(responseName))
      .join('');
  }

  constructor(
    _type: GraphQLCompositeType,
    private parentFields: Field[] = [],
  ) {}

  nested(field: Field, type: GraphQLCompositeType) {
    return new ObjectStack(type, [...this.parentFields, field]);
  }

  fragment(type: GraphQLCompositeType) {
    return new ObjectStack(type, this.parentFields);
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
      variables
        .filter(isTypedVariable)
        .map((variable) => tsPropertyForVariable(variable, context)),
    ),
  );
}

function isTypedVariable(
  variable: Variable | TypedVariable,
): variable is TypedVariable {
  return variable.type != null;
}

function tsPropertyForVariable(
  {name, type}: TypedVariable,
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

  const unwrappedGraphQLType = isNonNullType(graphQLType)
    ? graphQLType.ofType
    : graphQLType;

  if (isScalarType(unwrappedGraphQLType)) {
    if (scalarTypeMap.hasOwnProperty(unwrappedGraphQLType.name)) {
      type = scalarTypeMap[unwrappedGraphQLType.name];
    } else {
      context.import(unwrappedGraphQLType.name);
      type = t.tsTypeReference(t.identifier(unwrappedGraphQLType.name));
    }
  } else if (
    isEnumType(unwrappedGraphQLType) ||
    isInputObjectType(unwrappedGraphQLType)
  ) {
    context.import(unwrappedGraphQLType.name);
    type = t.tsTypeReference(t.identifier(unwrappedGraphQLType.name));
  } else {
    const {ofType} = unwrappedGraphQLType;
    const arrayType = tsTypeForGraphQLInputType(ofType, context);
    type = t.tsArrayType(
      isNonNullType(ofType) ? arrayType : t.tsParenthesizedType(arrayType),
    );
  }

  return isNonNullType(graphQLType)
    ? type
    : t.tsUnionType([type, t.tsNullKeyword()]);
}

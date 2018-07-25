import {ucFirst} from 'change-case';
import {GraphQLCompositeType} from 'graphql';
import {Field} from 'graphql-tool-utilities/ast';

export class ObjectStack {
  private seenFields = new Set<string>();

  get name(): string {
    const {parent, field, isFragment, type} = this;
    const name = `${parent ? parent.name : ''}${ucFirst(field.responseName)}`;
    return isFragment ? `${name}${type ? type.name : 'Other'}` : name;
  }

  constructor(
    private type: GraphQLCompositeType | undefined,
    private field: Field,
    private parent?: ObjectStack,
    private isFragment = false,
  ) {}

  nested(field: Field, type: GraphQLCompositeType) {
    return new ObjectStack(type, field, this);
  }

  fragment(type?: GraphQLCompositeType) {
    return new ObjectStack(type, this.field, this.parent, true);
  }

  sawField(field: Field) {
    this.seenFields.add(field.responseName);
  }

  hasSeenField(field: Field) {
    return this.seenFields.has(field.responseName);
  }
}

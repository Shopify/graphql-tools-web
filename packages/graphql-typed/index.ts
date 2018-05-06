import {DocumentNode as BaseDocumentNode} from 'graphql';

export interface DocumentNode<Data = {}, Variables = {}, DeepPartial = {}>
  extends BaseDocumentNode {}

import { ModelKind, ParsedModel } from './model-parse';

export interface ModelWorkerRequest {
  url: string;
  kind: ModelKind;
}

export type ModelWorkerMessage =
  | { type: 'progress'; loaded: number; total: number | null }
  | { type: 'parsing' }
  | { type: 'error'; message: string }
  | { type: 'done'; model: ParsedModel };

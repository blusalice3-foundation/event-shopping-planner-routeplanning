/** A display-only owner. Never serialize this session into application data. */
export interface MapEditorSession {
  readonly sessionId: string;
  readonly eventName: string;
  readonly eventGeneration: number;
  readonly day: string;
  readonly mapKey: string;
  readonly editorKind:
    | "block-definition"
    | "hall-definition"
    | "simple-hall-definition";
}

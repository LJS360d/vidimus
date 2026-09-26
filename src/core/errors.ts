export class UsageError extends Error {
  override name = 'UsageError';
}

export class MissingPeerError extends Error {
  override name = 'MissingPeerError';
  readonly peer: string;

  constructor(peer: string) {
    super(`"${peer}" is not installed. Add it as a dev dependency: npm i -D ${peer}`);
    this.peer = peer;
  }
}

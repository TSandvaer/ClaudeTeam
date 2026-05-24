/**
 * Shared Layer-3 test helpers.
 *
 * `asPromise` adapts the `Thenable<T>` returned by the VS Code API to a real
 * `Promise<T>` so node's `assert.doesNotReject` / `assert.rejects` accept it.
 * VS Code's API surface deliberately uses `Thenable` (not `Promise`) for
 * cross-runtime portability; node's strict assertion overloads require a true
 * Promise.
 */

export function asPromise<T>(thenable: Thenable<T>): Promise<T> {
  return Promise.resolve(thenable);
}

/**
 * A refusal the client should see.
 *
 * Its own module so that code with something to refuse does not have to import
 * the action layer — and with it the whole auth stack — just to say no. The
 * text-check guard is the reason: it is a pure rule about words, and it should
 * be testable without a session.
 */
export class ActionError extends Error {
  /**
   * Puts the message under the field it is about, which is the difference
   * between "something is wrong" and "this box needs a link".
   */
  readonly fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

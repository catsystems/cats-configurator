export class BoardCommandError extends Error {
  constructor(message, { command, output = [], cause } = {}) {
    super(message, { cause });
    this.name = "BoardCommandError";
    this.command = command;
    this.output = output;
  }
}

export class BoardCommandEngine {
  constructor({
    write,
    parsePrompt,
    normalizeCommand = (command) => command.trim().toLowerCase(),
    timeoutMs = 2500,
    retries = 1,
    settleMs = 75,
  }) {
    if (typeof write !== "function" || typeof parsePrompt !== "function") {
      throw new TypeError(
        "Board command engine requires write and prompt handlers.",
      );
    }
    this.write = write;
    this.parsePrompt = parsePrompt;
    this.normalizeCommand = normalizeCommand;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.settleMs = settleMs;
    this.queue = [];
    this.running = false;
    this.activeAttempt = null;
  }

  get busy() {
    return this.running || this.queue.length > 0 || this.activeAttempt !== null;
  }

  run(command, options = {}) {
    return this.#enqueue((execute) => execute(command, options));
  }

  poll(command, options = {}) {
    if (this.busy) return Promise.resolve(null);
    return this.run(command, { ...options, retries: 0 });
  }

  transaction(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Board transaction callback must be a function.");
    }
    return this.#enqueue(callback);
  }

  receive(data) {
    if (typeof data !== "string") return false;
    let consumed = false;
    for (const line of data.split(/\r?\n/).filter(Boolean)) {
      consumed = this.#receiveLine(line) || consumed;
    }
    return consumed;
  }

  #receiveLine(line) {
    const attempt = this.activeAttempt;
    if (!attempt) return false;

    const promptCommand = this.parsePrompt(line);
    if (promptCommand !== null) {
      if (promptCommand) {
        if (
          this.normalizeCommand(promptCommand) ===
          this.normalizeCommand(attempt.command)
        ) {
          attempt.acknowledged = true;
          attempt.output.length = 0;
        }
      } else if (attempt.acknowledged) {
        this.#finishAttempt();
      }
      return true;
    }

    if (
      !attempt.acknowledged &&
      this.normalizeCommand(line) === this.normalizeCommand(attempt.command)
    ) {
      attempt.acknowledged = true;
      attempt.output.length = 0;
      return true;
    }

    if (attempt.acknowledged) {
      attempt.output.push(line);
      attempt.onOutput?.(line);
      if (attempt.resetTimeoutOnOutput) this.#scheduleTimeout();
      if (!attempt.waitForPrompt) this.#scheduleSettle();
    }
    return attempt.acknowledged;
  }

  cancel(reason = "Board connection closed.") {
    const error =
      reason instanceof Error ? reason : new BoardCommandError(reason);
    if (this.activeAttempt) this.#finishAttempt(error);
    const pending = this.queue.splice(0);
    pending.forEach(({ reject }) => reject(error));
  }

  #enqueue(callback) {
    return new Promise((resolve, reject) => {
      this.queue.push({ callback, resolve, reject });
      void this.#pump();
    });
  }

  async #pump() {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) return;
    this.running = true;
    try {
      const execute = (command, options) => this.#execute(command, options);
      item.resolve(await item.callback(execute));
    } catch (error) {
      item.reject(error);
    } finally {
      this.running = false;
      void this.#pump();
    }
  }

  async #execute(command, options = {}) {
    if (typeof command !== "string" || !command.trim()) {
      throw new TypeError("Board command must be a non-empty string.");
    }
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? this.retries;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const output = await this.#attempt(command, timeoutMs, options);
        const protocolError = output.find((line) =>
          /^error\b/i.test(line.trim()),
        );
        if (protocolError) {
          throw new BoardCommandError(protocolError, { command, output });
        }
        return { command, output, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (error instanceof BoardCommandError && error.output.length > 0) {
          break;
        }
      }
    }

    throw lastError;
  }

  #attempt(command, timeoutMs, options) {
    return new Promise((resolve, reject) => {
      this.activeAttempt = {
        command,
        acknowledged: false,
        output: [],
        resolve,
        reject,
        timer: null,
        settleTimer: null,
        timeoutMs,
        onOutput: options.onOutput,
        resetTimeoutOnOutput: options.resetTimeoutOnOutput === true,
        waitForPrompt: options.waitForPrompt === true,
      };
      this.#scheduleTimeout();

      Promise.resolve(this.write(command)).catch((cause) => {
        if (this.activeAttempt?.command !== command) return;
        this.#finishAttempt(
          new BoardCommandError(`Could not write board command: ${command}`, {
            command,
            output: [...this.activeAttempt.output],
            cause,
          }),
        );
      });
    });
  }

  #scheduleTimeout() {
    const attempt = this.activeAttempt;
    if (!attempt) return;
    clearTimeout(attempt.timer);
    attempt.timer = setTimeout(() => {
      if (this.activeAttempt !== attempt) return;
      this.#finishAttempt(
        new BoardCommandError(`Board command timed out: ${attempt.command}`, {
          command: attempt.command,
          output: [...attempt.output],
        }),
      );
    }, attempt.timeoutMs);
  }

  #scheduleSettle() {
    const attempt = this.activeAttempt;
    if (!attempt) return;
    clearTimeout(attempt.settleTimer);
    attempt.settleTimer = setTimeout(
      () => this.#finishAttempt(),
      this.settleMs,
    );
  }

  #finishAttempt(error) {
    const attempt = this.activeAttempt;
    if (!attempt) return;
    this.activeAttempt = null;
    clearTimeout(attempt.timer);
    clearTimeout(attempt.settleTimer);
    if (error) attempt.reject(error);
    else attempt.resolve([...attempt.output]);
  }
}

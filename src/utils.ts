import { Notice } from "obsidian";

export function snapshot (input: unknown): unknown {
        if (input === null || typeof input !== 'object') return input;  
        const serializable = toSerializable(input);
        const json = JSON.stringify(serializable);
        return json === undefined ? serializable : JSON.parse(json);
};

function toSerializable (value: unknown, seen = new WeakSet<object>()): unknown  {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Set) return [...value].map((item) => toSerializable(item, seen));
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of value.entries()) {
      obj[String(key)] = toSerializable(val, seen);
    }
    return obj;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => toSerializable(item, seen));

  const plain: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    plain[key] = toSerializable(val, seen);
  }
  return plain;
};

export class Notifier {
        constructor(private source: string) {}

        static create(source: string): Notifier;
        static create(source: new (...args: any[]) => any): Notifier;

        static create(source: string | (new (...args: any[]) => any)): Notifier {
                if (typeof source === 'string') {
                        return new Notifier(source);
                } else {
                        return new Notifier(source.name);
                }
        }

        send(message: string): Notice {
                return new Notice(`[${this.source}]: ${message}`, 10 * 1000);
        }

        warn(message: string): Notice {
                return new Notice(`[${this.source}]: ⚠️ Warning: ${message}`, 0);
        }

        error(message: string): Notice {
                return new Notice(`[${this.source}]: ❌ Error: ${message}`, 0);
        }
}

export class ConsoleLogger {
        constructor(private source: string) {}

        static create(source: string): ConsoleLogger;
        static create(source: new (...args: any[]) => any): ConsoleLogger;

        static create(source: string | (new (...args: any[]) => any)): ConsoleLogger {
                if (typeof source === 'string') {
                        return new ConsoleLogger(source);
                } else {
                        return new ConsoleLogger(source.name);
                }
        }


        log(...values: unknown[]): void {
                console.log(`[${this.source}]: `, ...values.map(snapshot));
        }

        debug(...values: unknown[]): void {
                console.debug(`[${this.source}]: DEBUG: `, ...values.map(snapshot));
        }

        info(...values: unknown[]): void {
                console.info(`[${this.source}]: INFO: `, ...values.map(snapshot));
        }

        warn(...values: unknown[]): void {
                console.warn(`[${this.source}]: ⚠️ WARN: `, ...values.map(snapshot));
        }

        error(...values: unknown[]): void {
                console.error(`[${this.source}]: ❌ ERROR: `, ...values.map(snapshot));
        }
}
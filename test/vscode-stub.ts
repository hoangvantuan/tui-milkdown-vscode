import * as fs from "node:fs";
import * as path from "node:path";

export class Uri {
  readonly scheme: string;
  readonly path: string;
  readonly fsPath: string;

  private constructor(fsPath: string, scheme = "file") {
    this.fsPath = path.resolve(fsPath);
    this.path = this.fsPath;
    this.scheme = scheme;
  }

  static file(fsPath: string): Uri {
    return new Uri(fsPath, "file");
  }

  static parse(uriString: string): Uri {
    const parsed = new URL(uriString);
    return new Uri(parsed.pathname, parsed.protocol.replace(/:$/, ""));
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export interface WarningCall {
  message: string;
  items: string[];
}

type WarningChoiceHandler = string | undefined | ((message: string, items: string[]) => string | undefined);

let currentWorkspaceRoot: string | null = null;
const warningCalls: WarningCall[] = [];
let warningChoiceHandler: WarningChoiceHandler = undefined;
const deletedUris: Uri[] = [];

export interface ExecutedCommand {
  command: string;
  args: any[];
}
const executedCommands: ExecutedCommand[] = [];

export function setWorkspaceRoot(dir: string | null): void {
  currentWorkspaceRoot = dir ? path.resolve(dir) : null;
}

export function setWarningChoice(handler: WarningChoiceHandler): void {
  warningChoiceHandler = handler;
}

export function getWarningCalls(): readonly WarningCall[] {
  return [...warningCalls];
}

export function getDeletedUris(): readonly Uri[] {
  return [...deletedUris];
}

export function getExecutedCommands(): readonly ExecutedCommand[] {
  return [...executedCommands];
}

export function resetStub(): void {
  currentWorkspaceRoot = null;
  warningCalls.length = 0;
  warningChoiceHandler = undefined;
  deletedUris.length = 0;
  executedCommands.length = 0;
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        results.push(...(await walkDir(fullPath)));
      }
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

export const window = {
  async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    warningCalls.push({ message, items });
    if (typeof warningChoiceHandler === "function") {
      return warningChoiceHandler(message, items);
    }
    if (typeof warningChoiceHandler === "string") {
      return warningChoiceHandler;
    }
    return items.length > 0 ? items[0] : undefined;
  },

  async showQuickPick<T extends { label: string }>(
    items: T[],
    _options?: any,
  ): Promise<T | undefined> {
    return items.length > 0 ? items[0] : undefined;
  },
};

export const workspace = {
  fs: {
    async stat(uri: Uri): Promise<{ type: number; size: number; mtime: number }> {
      const stats = await fs.promises.stat(uri.fsPath);
      return {
        type: stats.isDirectory() ? 2 : 1,
        size: stats.size,
        mtime: stats.mtimeMs,
      };
    },

    async readFile(uri: Uri): Promise<Uint8Array> {
      return await fs.promises.readFile(uri.fsPath);
    },

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      await fs.promises.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fs.promises.writeFile(uri.fsPath, content);
    },

    async createDirectory(uri: Uri): Promise<void> {
      await fs.promises.mkdir(uri.fsPath, { recursive: true });
    },

    async rename(source: Uri, target: Uri, options?: { overwrite?: boolean }): Promise<void> {
      await fs.promises.mkdir(path.dirname(target.fsPath), { recursive: true });
      if (!options?.overwrite && fs.existsSync(target.fsPath)) {
        throw new Error(`Target file already exists: ${target.fsPath}`);
      }
      await fs.promises.rename(source.fsPath, target.fsPath);
    },

    async delete(uri: Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
      deletedUris.push(uri);
      await fs.promises.rm(uri.fsPath, {
        force: true,
        recursive: options?.recursive ?? false,
      });
    },
  },

  async findFiles(
    include: string,
    _exclude?: string,
    _maxResults?: number
  ): Promise<Uri[]> {
    if (!currentWorkspaceRoot) {
      return [];
    }
    const allFiles = await walkDir(currentWorkspaceRoot);
    if (include === "**/*.md") {
      return allFiles
        .filter((file) => file.endsWith(".md"))
        .map((file) => Uri.file(file));
    }
    if (include.startsWith("**/")) {
      const suffix = include.slice(3);
      return allFiles
        .filter((file) => {
          const rel = path.relative(currentWorkspaceRoot!, file).split(path.sep).join("/");
          return rel === suffix || rel.endsWith("/" + suffix);
        })
        .map((file) => Uri.file(file));
    }
    const target = include;
    return allFiles
      .filter((file) => {
        const rel = path.relative(currentWorkspaceRoot!, file).split(path.sep).join("/");
        return rel === target;
      })
      .map((file) => Uri.file(file));
  },
};

export const EndOfLine = { LF: 1, CRLF: 2 };
export class Range {}
export class Position {}
export class WorkspaceEdit {}
export const commands = {
  async executeCommand(command: string, ...args: any[]): Promise<any> {
    executedCommands.push({ command, args });
    return undefined;
  },
};

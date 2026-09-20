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

  // `resolveImagePath` reaches for this on every relative path, so anything
  // driving the host's image code through the stub needs it present.
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(path.join(base.fsPath, ...segments), base.scheme);
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

  get workspaceFolders() {
    if (!currentWorkspaceRoot) return undefined;
    return [{ uri: Uri.file(currentWorkspaceRoot), name: "root", index: 0 }];
  },

  getWorkspaceFolder(uri: Uri) {
    if (!currentWorkspaceRoot) return undefined;
    const folderPath = path.resolve(currentWorkspaceRoot);
    if (path.resolve(uri.fsPath).startsWith(folderPath)) {
      return { uri: Uri.file(folderPath), name: "root", index: 0 };
    }
    return undefined;
  },

  asRelativePath(pathOrUri: string | Uri, _includeWorkspaceFolder?: boolean): string {
    const filePath = typeof pathOrUri === "string" ? pathOrUri : pathOrUri.fsPath;
    if (!currentWorkspaceRoot) return filePath;
    const rel = path.relative(currentWorkspaceRoot, filePath).split(path.sep).join("/");
    return rel;
  },

  getConfiguration(section?: string) {
    const settingsPath = currentWorkspaceRoot
      ? path.join(currentWorkspaceRoot, ".vscode", "settings.json")
      : null;

    function readSettings(): Record<string, any> {
      if (settingsPath && fs.existsSync(settingsPath)) {
        try {
          return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        } catch {
          return {};
        }
      }
      return {};
    }

    return {
      get<T>(key: string, defaultValue?: T): T {
        const fullKey = section ? `${section}.${key}` : key;
        const settings = readSettings();
        return (settings[fullKey] !== undefined ? settings[fullKey] : defaultValue) as T;
      },
      inspect<T>(key: string) {
        const fullKey = section ? `${section}.${key}` : key;
        const settings = readSettings();
        return {
          key: fullKey,
          defaultValue: undefined,
          globalValue: undefined,
          workspaceValue: settings[fullKey],
          workspaceFolderValue: undefined,
        };
      },
      async update(key: string, value: any, _target?: number): Promise<void> {
        if (!currentWorkspaceRoot || !settingsPath) return;
        const fullKey = section ? `${section}.${key}` : key;
        const settings = readSettings();
        if (value === undefined) {
          delete settings[fullKey];
        } else {
          settings[fullKey] = value;
        }
        await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
        await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
      },
    };
  },
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
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

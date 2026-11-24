import * as vscode from "vscode";

const WORKSPACE_SCHEME = "battlebuket-workspace";

type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number;
  mtimeMs: number;
};

function relativePath(uri: vscode.Uri): string {
  return uri.path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export class BattleBuketFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private authority = "unbound";
  private authoritySequence = 0;

  setWorkspaceRoot(_workspacePath: string): vscode.Uri {
    this.authority = "workspace-" + (++this.authoritySequence).toString(36);
    return vscode.Uri.from({ scheme: WORKSPACE_SCHEME, authority: this.authority, path: "/" });
  }

  private validateUri(uri: vscode.Uri): string {
    if (uri.scheme !== WORKSPACE_SCHEME || uri.authority !== this.authority) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    const path = relativePath(uri);
    if (path.split("/").some(segment => segment === ".." || segment.includes("\0"))) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    return path;
  }

  private toFileError(error: unknown, uri: vscode.Uri): never {
    const message = error instanceof Error ? error.message : String(error);
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "ENOENT" || /does not exist|no such file/i.test(message)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (code === "EEXIST" || /already exists/i.test(message)) {
      throw vscode.FileSystemError.FileExists(uri);
    }
    if (/outside the selected workspace|symbolic links|permissions|access denied|not permitted/i.test(message)) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    if (/64 MB/.test(message)) throw vscode.FileSystemError.Unavailable(message);
    throw vscode.FileSystemError.Unavailable(message);
  }

  private fire(uri: vscode.Uri, type: vscode.FileChangeType): void {
    this.changes.fire([{ type, uri }]);
  }

  watch(uri: vscode.Uri, _options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
    this.validateUri(uri);
    // Workspace-wide native watching is owned by the Electron main process.
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const path = this.validateUri(uri);
    if (!path) {
      const now = Date.now();
      return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
    }
    const separator = path.lastIndexOf("/");
    const parent = separator < 0 ? "" : path.slice(0, separator);
    const name = separator < 0 ? path : path.slice(separator + 1);
    try {
      const entries = await window.battleBuket!.listWorkspace(parent);
      const entry = entries.find((item: WorkspaceEntry) => item.name === name);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      return {
        type: entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: entry.mtimeMs,
        mtime: entry.mtimeMs,
        size: entry.size
      };
    } catch (error) {
      if (error instanceof vscode.FileSystemError) throw error;
      return this.toFileError(error, uri);
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const path = this.validateUri(uri);
    try {
      const entries = await window.battleBuket!.listWorkspace(path);
      return entries.map((entry: WorkspaceEntry) => [
        entry.name,
        entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File
      ]);
    } catch (error) {
      return this.toFileError(error, uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const path = this.validateUri(uri);
    try {
      const result = await window.battleBuket!.readWorkspaceFileSystemFile(path);
      return result.content;
    } catch (error) {
      return this.toFileError(error, uri);
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const path = this.validateUri(uri);
    try {
      await window.battleBuket!.createWorkspaceDirectory(path);
      this.fire(uri, vscode.FileChangeType.Created);
    } catch (error) {
      this.toFileError(error, uri);
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
    const path = this.validateUri(uri);
    try {
      const exists = await this.stat(uri).then(() => true).catch(error => {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return false;
        throw error;
      });
      await window.battleBuket!.writeWorkspaceFileSystemFile({
        path,
        content,
        create: options.create,
        overwrite: options.overwrite
      });
      this.fire(uri, exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created);
    } catch (error) {
      this.toFileError(error, uri);
    }
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean; useTrash: boolean }): Promise<void> {
    const path = this.validateUri(uri);
    try {
      await window.battleBuket!.deleteWorkspacePath(path, options.recursive);
      this.fire(uri, vscode.FileChangeType.Deleted);
    } catch (error) {
      this.toFileError(error, uri);
    }
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    const oldPath = this.validateUri(oldUri);
    const newPath = this.validateUri(newUri);
    try {
      await window.battleBuket!.renameWorkspacePath(oldPath, newPath, options.overwrite);
      this.fire(oldUri, vscode.FileChangeType.Deleted);
      this.fire(newUri, vscode.FileChangeType.Created);
    } catch (error) {
      this.toFileError(error, oldUri);
    }
  }

  dispose(): void {
    this.changes.dispose();
  }
}

export { WORKSPACE_SCHEME };

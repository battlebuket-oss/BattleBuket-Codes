import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

type MonacoWorkerLabel =
  | "editorWorkerService"
  | "json"
  | "css"
  | "scss"
  | "less"
  | "html"
  | "handlebars"
  | "razor"
  | "javascript"
  | "typescript"
  | "extensionHostWorkerMain";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
  getWorkerUrl?(moduleId: string, label: string): string | undefined;
  getWorkerOptions?(moduleId: string, label: string): WorkerOptions | undefined;
};

const workerUrls: Partial<Record<MonacoWorkerLabel, URL>> = {
  editorWorkerService: new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
  json: new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
  css: new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
  scss: new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
  less: new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
  html: new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
  handlebars: new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
  razor: new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
  javascript: new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
  typescript: new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
  extensionHostWorkerMain: new URL("@codingame/monaco-vscode-api/workers/extensionHost.worker", import.meta.url)
};

function workerUrl(label: string): URL | undefined {
  return workerUrls[label as MonacoWorkerLabel] ?? workerUrls.editorWorkerService;
}

export function configureMonacoWorkers(): void {
  const environment: MonacoWorkerEnvironment = {
    getWorkerUrl(_moduleId, label) {
      return workerUrl(label)?.toString();
    },
    getWorkerOptions(_moduleId, label) {
      return workerUrl(label) ? { type: "module", name: "battlebuket-" + label } : undefined;
    },
    getWorker(_moduleId, label) {
      const url = workerUrl(label);
      if (!url) throw new Error("No Monaco worker is registered for label: " + label);
      return new Worker(url, { type: "module", name: "battlebuket-" + label });
    }
  };

  // The VS Code web workbench reads MonacoEnvironment from window; standalone
  // Monaco consumers read the same object from globalThis in the renderer.
  (window as Window & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment = environment;
  (globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment = environment;
}

configureMonacoWorkers();
loader.config({ monaco });

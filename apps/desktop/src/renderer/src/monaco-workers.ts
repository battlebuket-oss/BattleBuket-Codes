import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import ExtensionHostWorker from "@codingame/monaco-vscode-api/workers/extensionHost.worker?worker";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
};

function createWorker(Constructor: new (options?: WorkerOptions) => Worker, label: string): Worker {
  return new Constructor({ type: "module", name: "battlebuket-" + label });
}

export function configureMonacoWorkers(): void {
  const environment: MonacoWorkerEnvironment = {
    getWorker(_moduleId, label) {
      switch (label) {
        case "json":
          return createWorker(JsonWorker, label);
        case "css":
        case "scss":
        case "less":
          return createWorker(CssWorker, label);
        case "html":
        case "handlebars":
        case "razor":
          return createWorker(HtmlWorker, label);
        case "javascript":
        case "typescript":
          return createWorker(TypeScriptWorker, label);
        case "extensionHostWorkerMain":
          return createWorker(ExtensionHostWorker, label);
        case "editorWorkerService":
        default:
          return createWorker(EditorWorker, label || "editorWorkerService");
      }
    }
  };

  // The VS Code web workbench reads MonacoEnvironment from window; standalone
  // Monaco consumers read the same object from globalThis in the renderer.
  (window as Window & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment = environment;
  (globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment = environment;
}

configureMonacoWorkers();
loader.config({ monaco });

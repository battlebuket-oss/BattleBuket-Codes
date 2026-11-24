import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker&inline";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker&inline";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker&inline";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker&inline";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline";

type MonacoWorkerEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
  getWorkerUrl?(moduleId: string, label: string): string | undefined;
  getWorkerOptions?(moduleId: string, label: string): WorkerOptions | undefined;
};

const extensionHostWorkerUrl = new URL(
  "@codingame/monaco-vscode-api/workers/extensionHost.worker",
  import.meta.url
).toString();

export function configureMonacoWorkers(): void {
  (globalThis as typeof globalThis & { MonacoEnvironment?: MonacoWorkerEnvironment }).MonacoEnvironment = {
    getWorkerUrl(_moduleId, label) {
      return label === "extensionHostWorkerMain" ? extensionHostWorkerUrl : undefined;
    },
    getWorkerOptions(_moduleId, label) {
      return label === "extensionHostWorkerMain" ? { type: "module", name: "battlebuket-extension-host" } : undefined;
    },
    getWorker(_moduleId, label) {
      switch (label) {
        case "json": return new JsonWorker();
        case "css":
        case "scss":
        case "less": return new CssWorker();
        case "html":
        case "handlebars":
        case "razor": return new HtmlWorker();
        case "javascript":
        case "typescript": return new TypeScriptWorker();
        default: return new EditorWorker();
      }
    }
  };
}

configureMonacoWorkers();
loader.config({ monaco });

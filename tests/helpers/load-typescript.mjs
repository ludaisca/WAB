import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// El proyecto no usa un runner TS. Los tests de node cargan los módulos
// originales con el compilador ya instalado, sin instalar dependencias ni
// arrancar Next, Redis o workers. Los mocks solo sustituyen límites externos.
const root = fileURLToPath(new URL("../../", import.meta.url));

export default function loadTypescript(relativePath, mocks = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    const nativeRequire = createRequire(filename);
    const localRequire = (request) => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (request.startsWith("@/") || request.startsWith(".")) {
        const target = request.startsWith("@/")
          ? path.join(root, request.slice(2))
          : path.resolve(path.dirname(filename), request);
        if (fs.existsSync(`${target}.ts`)) return load(`${target}.ts`);
      }
      return nativeRequire(request);
    };
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    });
    const execute = new Function("require", "module", "exports", outputText);
    execute(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return load(path.resolve(root, relativePath));
};

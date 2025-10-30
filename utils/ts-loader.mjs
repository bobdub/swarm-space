import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const resolvedPath = pathToFileURL(path.join(process.cwd(), "src", specifier.slice(2))).href;
    return { url: resolvedPath };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    try {
      return await defaultResolve(specifier, context, defaultResolve);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && !specifier.endsWith(".ts")) {
        const attempt = `${specifier}.ts`;
        return defaultResolve(attempt, context, defaultResolve);
      }
      throw error;
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith(".ts")) {
    const source = await readFile(new URL(url), "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2020,
        target: ts.ScriptTarget.ES2020,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: "module",
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}

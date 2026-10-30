import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const rootDir = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  let targetPath = null;
  if (specifier.startsWith('@/')) {
    targetPath = path.join(rootDir, 'src', specifier.slice(2));
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    targetPath = path.resolve(parentDir, specifier);
  }

  if (targetPath) {
    const extensions = ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const fullPath = targetPath + ext;
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return {
          shortCircuit: true,
          url: pathToFileURL(fullPath).href,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const content = fs.readFileSync(new URL(url), 'utf-8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${content};`,
    };
  }
  return nextLoad(url, context);
}

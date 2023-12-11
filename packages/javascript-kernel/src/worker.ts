import { IJavaScriptWorkerKernel } from './tokens';

import * as vfs from '@typescript/vfs';
import inspect from 'object-inspect';

function storageMock() {
  let storage: any = {};

  return {
    setItem: function (key: any, value: any) {
      console.log('SET', key, value);
      storage[key] = value || '';
    },
    getItem: function (key: any) {
      console.log('GET', key);
      return key in storage ? storage[key] : null;
    },
    removeItem: function (key: any) {
      delete storage[key];
    },
    get length() {
      return Object.keys(storage).length;
    },
    key: function (i: any) {
      const keys = Object.keys(storage);
      return keys[i] || null;
    },
    clear: function () {
      storage = {};
    },
  };
}
export class JavaScriptRemoteKernel {
  private tsEnv: Promise<vfs.VirtualTypeScriptEnvironment>;

  constructor() {
    this.tsEnv = new Promise(async (resolve, reject) => {
      const ts = (
        await import(
          /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/typescript@5.3.3/+esm'
        )
      ).default;
      const fsMap = await vfs.createDefaultMapFromCDN(
        {
          target: ts.ScriptTarget.ES2021,
        },
        ts.version,
        true,
        ts,
        undefined,
        undefined,
        storageMock(),
      );
      const system = vfs.createSystem(fsMap);
      const tsEnv = vfs.createVirtualTypeScriptEnvironment(system, [], ts, {
        allowJs: true,
      });
      // tsEnv.createFile('/index.ts', 'let foo: string = 5;');
      resolve(tsEnv);
    });
    void this.tsEnv;
  }

  /**
   * Initialize the remote kernel.
   *
   * @param options The options for the kernel.
   */
  async initialize(options: IJavaScriptWorkerKernel.IOptions) {
    // eslint-disable-next-line no-console
    console.log = function (...args) {
      const bundle = {
        name: 'stdout',
        text: args.join(' ') + '\n',
      };
      postMessage({
        type: 'stream',
        bundle,
      });
    };
    // eslint-disable-next-line no-console
    console.info = console.log;

    console.error = function (...args) {
      const bundle = {
        name: 'stderr',
        text: args.join(' ') + '\n',
      };
      postMessage({
        type: 'stream',
        bundle,
      });
    };
    console.warn = console.error;

    self.onerror = function (message, source, lineno, colno, error) {
      console.error(message);
    };
  }

  /**
   * Execute code in the worker kernel.
   */
  async execute(content: any, parent: any) {
    const { code } = content;
    try {
      const tsEnv = await this.tsEnv;
      tsEnv.createFile('/index.ts', code);
      const output = tsEnv.languageService.getEmitOutput('/index.ts');
      console.log('output files', output.outputFiles);
      const diagnostics = tsEnv.languageService.getSyntacticDiagnostics('/index.ts');
      if (diagnostics.length > 0) {
        console.error(inspect(diagnostics));
      }
      const result = self.eval(output.outputFiles[0].text);
      this._executionCount++;

      const bundle = {
        data: {
          'text/plain': result,
        },
        metadata: {},
        execution_count: this._executionCount,
      };
      postMessage({
        bundle,
        type: 'execute_result',
      });

      return {
        status: 'ok',
        user_expressions: {},
      };
    } catch (e) {
      const { name, stack, message } = e as any as Error;
      const bundle = {
        ename: name,
        evalue: message,
        traceback: [`${stack}`],
      };

      postMessage({
        bundle,
        type: 'execute_error',
      });

      return {
        status: 'error',
        ename: name,
        evalue: message,
        traceback: [`${stack}`],
      };
    }
  }

  /**
   * Handle the complete message
   */
  async complete(content: any, parent: any) {
    // naive completion on window names only
    // TODO: improve and move logic to the iframe
    const vars = Object.getOwnPropertyNames(self);
    const { code, cursor_pos } = content;
    const words = code.slice(0, cursor_pos).match(/(\w+)$/) ?? [];
    const word = words[0] ?? '';
    const matches = vars.filter((v) => v.startsWith(word));

    return {
      matches,
      cursor_start: cursor_pos - word.length,
      cursor_end: cursor_pos,
      metadata: {},
      status: 'ok',
    };
  }

  private _executionCount = 0;
}

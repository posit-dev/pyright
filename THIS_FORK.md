# Pyright in the browser

This is a fork of Pyright which has been modified to run a web browser. Normally, Pyright runs in Node.js, but this version has been modified to run in a Web Worker in a web browser, so that no server is needed. The primary purpose of this is to use it in [shinylive.io](https://shinylive.io/py/examples/) ([source](https://github.com/posit-dev/shinylive)), so that users can get diagnostics and tooltips as they edit Shiny applications in a web browser.

This fork was originally based on a [fork by Micro:bit](https://github.com/microbit-foundation/pyright/blob/microbit/THIS_FORK.md) but it has diverged significantly since then. The changes in this fork make it easier to maintain and keep in sync with the main Microsoft fork, by moving most of the changes outside of the original Microsoft codebase.

The branch we are using is named [pyright-browser](https://github.com/posit-dev/pyright/tree/pyright-browser).


## Building

To build:

```bash
git clone https://github.com/posit-dev/pyright.git
cd pyright
npm ci
cd packages/browser-pyright
npm run build
```

This will produce `dist/pyright.worker.js`. This JavaScript file can launched in a Web Worker in a web browser.


## How it works

There are two source files inside of `packages/pyright-internal` which are shims:

- The module `node:worker_threads` is not available in a web browser, so we have a replacement, [`pyright-internal/src/worker_threads_shim.ts`](https://github.com/posit-dev/pyright/blob/pyright-browser/packages/pyright-internal/src/worker_threads_shim.ts). Any TS files which imported `worker_threads` have been modified to import `worker_threads_shim` instead.

- The file `pyright-internal/src/common/realFileSystem.ts` is used to access a real filesystem on disk. Web Workers don't have access to a real filesystem, so we create a virtual filesystem in memory and use that instead. The virtual filesystem wraps the `TestFileSystem` class from Pyright's testing code. This is done in a file named [`pyright-internal/src/common/testFileSystemShim.ts`](https://github.com/posit-dev/pyright/blob/pyright-browser/packages/pyright-internal/src/common/testFileSystemShim.ts). Any TS files which imported `realFileSystem` have been modified to import `testFileSystemShim` instead. This was inspired by the [Micro:bit fork](https://github.com/microbit-foundation/pyright/blob/microbit/THIS_FORK.md).

There are two possible ways that these shims could be used. One way is to not modify any existing code at all, and edit `browser-pyright/webpack.config.js` so that Webpack injects the shims into the bundle. The benefit of using webpack to inject the shims in the build phase is that it requires no changes to the existing code. However, during the editing phase, TypeScript will not be aware of the shims, and so there will be no type checking for the shim code.

The other way to use the shims is to _not_ inject them at build time, but instead modify the existing code to explicitly import the shims instead of the original modules. This does require maintaining some changed import lines in the original code, but it allows TypeScript to type check the shim code. This is the approach that we have used in this fork.

The virtual filesystem is expected to be populated at initialization time, via the `initializationOptions` in the []`initialize` request](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize). It should contain a key named `files` which is a JSON object where the key is the filename with path, and the value is the content of the file. For example:

```json
{
  "/typeshed/stdlib/io.pyi": "import abc\nimport builtins\nimport codecs\nimport sys ....",
  "/typeshed/stdlib/lzma.pyi": "import io\nfrom _typeshed import ReadableBuffer, StrOrBytesPath ...",
  ...
}
```

This can also contain a `/src/pyrightconfig.json` file to customize the Pyright settings.

The virtual filesystem add two custom notification types to the language server: one for creating files, and one for deleting files. This is what the editor should do when creating/deleting files. In practice, I have created the files in `/src` and subdirectories of it.

In addition to the shims, there is a new directory, `packages/browser-pyright/`, which contains the the code to run a pyright server in a Web Worker. The sources get compiled to a file named `pyright.worker.js`, which should be launched in a Web Worker in a browser. The main browser thread should launch the Web Worker, which in turn will launch another Web Worker to do background analysis.

See the contents of the files in [`packages/browser-pyright/`](https://github.com/posit-dev/pyright/tree/pyright-browser/packages/browser-pyright/src) for more explanations of how they work.


## How to use it

For an example of how to launch the Pyright server in a Web Worker, see [this code in Shinylive](https://github.com/posit-dev/shinylive/blob/e7030bf9287be40b8022b54aced524ec8c73f1c0/src/language-server/pyright-client.ts).


## Keeping in sync with the Microsoft fork

In order to stay in sync with the main fork at https://github.com/microsoft/pyright/, the basic procedure is to:

```bash
# Clone this repository
git clone https://github.com/posit-dev/pyright.git
cd pyright

# Add the Microsoft fork as a remote named 'ms'
git remote add ms https://github.com/microsoft/pyright.git
get fetch
```

At this point, it will have fetched the `main` branch, and many tags. You can see the latest tags by running:

```bash
git tag | sort --version-sort
```

Then merge in the most recent tag. If the tag is `1.1.365`, you would run:

```bash
git merge 1.1.365
```

Next, update `packages/browser-pyright/packages.json` so that it has the same version number.

Hopefully this will work without any merge conflicts. If there are merge conflicts, resolve them and then try to build pyright:

```bash
npm ci
cd packages/browser-pyright
npm run build
```

Also check if the versions of dependencies in `browser-pyright/packages.json` match the versions in `pyright-internal/packages.json`. If they don't, update them and then run `npm install`.


If this works, then you can test if it works from the other end. (Note that it would be good to add automated tests of functionality to this repository.) If so, you can push the new merged commit to GitHub.

If there are any problems at this point, then you may need to make some fixes. It is possible that some files have added new imports from the shimmed files described above. Those can be easily fixed:

- Change any instances of `import { ... } from 'worker_threads'` to  `import { ... } from '../worker_threads_shim'` (and fix the relative path as necessary).
- Change any instances of `import { ... } from './common/realFileSystem'` to  `import { ... } from './common/testFileSystemShim'`.

It is possible that there will be more substantive changes which require deeper code modifications.

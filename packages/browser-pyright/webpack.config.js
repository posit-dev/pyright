/**
 * webpack.config-cli.js
 * Copyright: Microsoft 2018
 */

const path = require('path');
const { ProvidePlugin, DefinePlugin, NormalModuleReplacementPlugin } = require('webpack');
const { cacheConfig, monorepoResourceNameMapper, tsconfigResolveAliases } = require('../../build/lib/webpack');

const outPath = path.resolve(__dirname, 'dist');

/**@type {(env: any, argv: { mode: 'production' | 'development' | 'none' }) => import('webpack').Configuration}*/
module.exports = (_, { mode }) => {
    return {
        context: __dirname,
        entry: {
            pyright: './src/worker.ts',
        },
        output: {
            filename: '[name].worker.js',
            path: outPath,
            devtoolModuleFilenameTemplate:
                mode === 'development' ? '../[resource-path]' : monorepoResourceNameMapper('pyright'),
            clean: true,
        },
        devtool: mode === 'development' ? 'source-map' : 'nosources-source-map',
        cache: mode === 'development' ? cacheConfig(__dirname, __filename) : false,
        stats: {
            all: false,
            errors: true,
            warnings: true,
        },
        resolve: {
            extensions: ['.ts', '.js'],
            alias: tsconfigResolveAliases('tsconfig.json'),
            fallback: {
                // There's a lot of code we're pulling in that uses NodeJS.
                //  Much of it should be cut out by refactoring but for now we hack it out.

                // At least TestFileSystem, which perhaps we should replace
                // to avoid buffer polyfill
                buffer: require.resolve('buffer/'),
                // pythonPathUtils.ts but shouldn't be used as it execs python, configOptions.ts but we avoid reading from disk
                child_process: false,
                // Falls back to web crypto.
                crypto: false,
                // Needs at least path.sep in pathUtils.ts, pathValidation.ts etc.
                path: require.resolve('path-browserify'),
                // TOML parsing which we don't use
                stream: false,
                // fileBasedCancellationUtils (we've removed the RealFileSystem)
                fs: false,
                os: false,

                util: require.resolve('util/'),
            },
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json',
                    },
                },
            ],
        },
        plugins: [
            new ProvidePlugin({
                process: require.resolve('./src/process-shim.ts'),
                Buffer: ['buffer', 'Buffer'],
            }),
            new NormalModuleReplacementPlugin(/^v8$/, __dirname + '/src/v8-shim.ts'),
            new DefinePlugin({
                // We use this to get the current URL to launch a Worker().
                '__filename': 'self.location.href',
            }),
        ],
        watch: true,
    };
};

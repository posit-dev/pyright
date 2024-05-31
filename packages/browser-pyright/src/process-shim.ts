// This is a shim for the Node.js process object, for use in the browser.

export const plaform: string = 'browser';

export const env = {NODE_DEBUG: 'production', READABLE_STREAM: 'disable'};

export const execArgv: Array<string> = [];

export function cwd() {
    return '/';
}

export function memoryUsage() {
    return {heapUsed: 0, rss: 1};
}


/// <reference lib="WebWorker" />

// This file is a shim for the node:worker_threads module, and is implemented
// with using browser APIs.
// The node versions of Worker, MessagePort, and MessageChannel are different
// from the browser versions, but we can implement enough of the node versions
// for pyright to work, using browser APIs.

import type { WorkerOptions } from 'node:worker_threads';
import { BaseUri } from './common/uri/baseUri';

// This is a subset of TransferListItem from node:worker_threads, but it is
// sufficient for our needs.
export type TransferListItem = ArrayBuffer | MessagePort | Blob;

// In the BackgroundAnalysis constructor, workerData is passed to the Worker
// constructor, and in the node:worker_threads implementation of Worker,
// workerData, is immediately available in the new worker as
// worker_threads.workerData. Web Workers do not allow passing data this way, so
// we hard code this value here.
// TODO: allow passing workerData by posting a message to the worker.
export let workerData: any = undefined;

export function setWorkerData(data: any) {
    workerData = data;
}

// This Worker class looks like the one from node:worker_threads, which is
// different from the Web Worker API. It wraps a Web Worker.
export class Worker {
    webWorker: globalThis.Worker;

    // The constructor is slightly different from the
    // node:worker_threads.Worker. It has the additional parameter
    // webWorkerOptions, which allows passing options to the underlying Web
    // Worker.
    constructor(filename: string | URL, options?: WorkerOptions, webWorkerOptions?: globalThis.WorkerOptions) {
        this.webWorker = new globalThis.Worker(filename, webWorkerOptions);
    }

    postMessage(value: any, transferList?: ReadonlyArray<TransferListItem>): void {
        value = shallowReplace(value, sanitizeObject);
        // Special casing of value.data. Not great.
        // TODO: Find a better way to handle this.
        if (value.data) {
            value.data = shallowReplace(value.data, sanitizeObject);
        }
        this.webWorker.postMessage(unwrapForSend(value), unwrapForSend(transferList));
    }

    on(type: 'message' | 'error' | 'exit', listener: (data: any) => void): this {
        if (type === 'message') {
            this.webWorker.addEventListener('message', (e: MessageEvent) => {
                listener(wrapOnReceive(e.data));
            });
        } else if (type === 'error') {
            // We don't support error/exit for now.
            // this.worker.addEventListener('error', (e: ErrorEvent) => listener(e.error));
        } else if (type === 'exit') {
            // this.worker.addEventListener('exit', (ev: MessageEvent<any>) => listener(ev.data));
        }

        return this;
    }

    async terminate(): Promise<number> {
        this.webWorker.terminate();
        return 1;
    }
}

// Note that noder:worker_threads.MessageChannel differs from
// globalThis.MessageChannel. The latter is the browser API version.
export class MessageChannel {
    port1: MessagePort;
    port2: MessagePort;

    constructor() {
        const channel = new globalThis.MessageChannel();
        this.port1 = new MessagePort(channel.port1);
        this.port2 = new MessagePort(channel.port2);
    }
}

// Objects that can be wrapped into MessagePort objects. This includes
// globalThis.MessagePort as well as self (the global scope in a Web Worker).
interface MessagePortWrappable {
    postMessage(value: any, transferList?: ReadonlyArray<Transferable>): void;
    addEventListener(type: 'message' | 'error' | 'exit', listener: (data: any) => void): void;
    start?: () => void;
    close?: () => void;
}

// Note that node:worker_threads.MessagePort differs from
// globalThis.MessagePort. The latter is the browser API version.
export class MessagePort {
    constructor(private _delegate: MessagePortWrappable) {}

    unwrap() {
        return this._delegate;
    }

    postMessage(value: any, transferList?: ReadonlyArray<TransferListItem>): void {
        // console.log('MessagePort.postMessage from ', isMainThread ? 'main' : 'background', value, transferList);
        // if (value.data) {
        //     console.log('MessagePort.postMessage data', JSON.parse(value.data));
        // }
        if (transferList) {
            this._delegate.postMessage(unwrapForSend(value), unwrapForSend(transferList));
        } else {
            // Some objects, like Uri, can't be cloned, so we need to serialize
            // and deserialized them so that they can be posted.
            const sanitizedObj = JSON.parse(JSON.stringify(value));
            this._delegate.postMessage(sanitizedObj);
        }
    }

    on(type: 'message' | 'error' | 'exit', listener: (data: any) => void): this {
        // We don't support error/exit for now.
        if (type === 'message') {
            this._delegate.addEventListener(type, (e: MessageEvent) => {
                const data = e.data;
                listener(wrapOnReceive(data));
            });
            this.start();
        }
        return this;
    }

    start() {
        if (this._delegate.start) this._delegate.start();
    }

    close() {
        if (this._delegate.close) this._delegate.close();
    }
}

export const parentPort: MessagePort = new MessagePort(self);

export const threadId = self.name;

// Unlike in node:worker_threads, this value starts unset. It must be set by
// calling setIsMainThread() early on in the worker thread's startup.
export let isMainThread: boolean;

// Note: This must be called early on by the worker thread!
export function setIsMainThread(value: boolean) {
    isMainThread = value;
}

// =============================================================================
// Internal utility functions
// =============================================================================
function sanitizeObject(value: object): object {
    // This is crude - this check shouldn't just include BaseUri - it should be
    // more general.

    // Some objects, like Uri, can't be cloned, so we need to serialize and
    // deserialized them so that they can be posted.
    if (value instanceof BaseUri) {
        return JSON.parse(JSON.stringify(value));
    }
    return value;
}

// Utility function for implementations for wrapping/unwrapping of transferable values.
function shallowReplace(value: any, mapper: (v: any) => any) {
    if (Array.isArray(value)) {
        return value.map(mapper);
    }
    if (isPlainObject(value)) {
        const shallowCopy = Object.create(null);
        Object.entries(value).forEach(([k, v]) => {
            shallowCopy[k] = mapper(v);
        });
        return shallowCopy;
    }
    return mapper(value);
}

function isPlainObject(v: any): boolean {
    return Object.prototype.toString.call(v) === '[object Object]';
}

function unwrapForSend(value: any): any {
    return shallowReplace(value, (v: any) => {
        return v instanceof MessagePort ? v.unwrap() : v;
    });
}

function wrapOnReceive(value: any): any {
    return shallowReplace(value, (v: any) => {
        return v instanceof globalThis.MessagePort ? new MessagePort(v) : v;
    });
}

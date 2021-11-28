import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

export class SessionInfo {
    constructor(
        public session: vscode.DebugSession,
        public threadId: number,
        public frameId: number)
    {}
}

export enum Endianness { Little, Big };

export class MachineInfo {
    constructor(
        public pointerSize: number,
        public endianness: Endianness)
    {}
}

export enum Language { Cpp, Java, JavaScript, Python };

export class Debugger {
    private _onStopped: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onStopped: vscode.Event<void> = this._onStopped.event;
    private _onUnavailable: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	readonly onUnavailable: vscode.Event<void> = this._onUnavailable.event;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory("*", {
            createDebugAdapterTracker: session => {
                return {
                    onDidSendMessage: async (message: DebugProtocol.ProtocolMessage) => {
                        if (message.type === 'event') {
                            const event = message as DebugProtocol.Event;
                            if (event.event === 'stopped') {
                                const threadId = (message as DebugProtocol.StoppedEvent).body.threadId;
                                if (threadId) {
                                    const frameId = await this._frameId(session, threadId);
                                    if (frameId) {
                                        this.sessionInfo = new SessionInfo(session, threadId, frameId);
                                        this._onStopped.fire();
                                    } else {
                                        this._setUnavailable();
                                    }
                                } else {
                                    this._setUnavailable();
                                }
                            } else if (event.event === 'continued'
                                    || event.event === 'exited'
                                    || event.event === 'terminated') {
                                this._setUnavailable();
                            }
                        } else if (message.type === 'response') {
                            const response = message as DebugProtocol.Response
                            if (response.command === 'continue'
                             || response.command === 'next'
                             || response.command === 'stepIn'
                             || response.command === 'stepOut'
                             || response.command === 'stepBack'
                             || response.command === 'reverseContinue'
                             || response.command === 'goto'
                             || response.command === 'disconnect'
                             || response.command === 'initialize'
                             || response.command === 'launch') {
                                this._setUnavailable();
                            }
                        }
                    }
                };
            }
        }));
    }

    private _setUnavailable() {
        if (this.sessionInfo) {
            this.sessionInfo = undefined;
            this._onUnavailable.fire();
        }
    }

    private async _frameId(session: vscode.DebugSession, threadId: number) {
        const stackArgs: DebugProtocol.StackTraceArguments = { threadId: threadId, startFrame: 0, levels: 1 };
        const stackTrace = await session.customRequest('stackTrace', stackArgs);
        if (stackTrace && stackTrace.stackFrames && stackTrace.stackFrames.length > 0) {
            const frame = stackTrace.stackFrames[0] as DebugProtocol.StackFrame;
            return frame.id;
        } else {
            return undefined;
        }
    }

    private async _evaluate(session: vscode.DebugSession, expression:string, frameId: number) {
        let exprArgs : DebugProtocol.EvaluateArguments = { expression: expression, frameId: frameId };
        let expr = await session.customRequest('evaluate', exprArgs);
        return expr;
    }

    private async _variables(session: vscode.DebugSession, variablesReference:number, count: number | undefined) {
        let exprArgs : DebugProtocol.VariablesArguments = { variablesReference: variablesReference, count: count };
        let expr = await session.customRequest('variables', exprArgs);
        return expr;
    }

    isStopped() : boolean {
        return this.sessionInfo !== undefined;
    }

    language(): Language | undefined {
        const sessionType = this.sessionInfo?.session?.type;
        if (sessionType === undefined)
            return undefined;
        if (['cppvsdbg', 'cppdbg'].includes(sessionType))
            return Language.Cpp;
        else if (sessionType === 'python')
            return Language.Python;
        else if (['node', 'chrome', 'msedge', 'pwa-node', 'pwa-chrome', 'pwa-msedge'].includes(sessionType))
            return Language.JavaScript;
        else if (sessionType === 'java')
            return Language.Java;
        else
            return undefined;
    }

    workspaceFolder(): string | undefined {
        if (this.sessionInfo === undefined)
            return undefined;
        return this.sessionInfo.session.workspaceFolder?.uri.fsPath;
    }

    async machineInfo() {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        const frameId = this.sessionInfo.frameId;
        if (session.type.indexOf('cpp') >= 0) {
            //const expr1 = await this._evaluate(session, '(unsigned int)((unsigned char)-1)', frameId);
            const expr2 = await this._evaluate(session, 'sizeof(void*)', frameId);
            if (expr2 === undefined || expr2.type === undefined)
                return undefined;
            let pointerSize: number = 0;
            if (expr2.result === '4')
                pointerSize = 4;
            else if (expr2.result === '8')
                pointerSize = 8;
            else
                return undefined;
            const expr3 = await this._evaluate(session, 'sizeof(unsigned long)', frameId);
            if (expr3 === undefined || expr3.type === undefined)
                return undefined;
            let endianness: Endianness | undefined = undefined;
            let expression = '';
            let expectedLittle = '';
            let expectedBig = '';
            if (expr3.result === '4') {
                expression = '*(unsigned long*)"abc"';
                expectedLittle = '6513249';
                expectedBig = '1633837824';
            } else if (expr3.result === '8') { 
                expression = '*(unsigned long*)"abcdefg"';
                expectedLittle = '29104508263162465';
                expectedBig = '7017280452245743360';
            } else
                return undefined;
            const expr4 = await this._evaluate(session, expression, frameId);
            if (expr4 === undefined || expr4.type === undefined)
                return undefined;
            if (expr4.result === expectedLittle)
                endianness = Endianness.Little;
            else if (expr4.result === expectedBig)
                endianness = Endianness.Big;
            else
                return undefined;
            return new MachineInfo(pointerSize, endianness);
        }
        return undefined;
    }

    async getType(expression: string): Promise<string | undefined> {
        let type = (await this.evaluate(expression))?.type;
        // TODO: checking for language each time is quite heavy,
        //       it could be done once when the session starts
        if (type === 'object' && this.language() === Language.JavaScript) {
            const expr = await this.evaluate('(' + expression + ').constructor.name');
            if (expr?.type !== undefined && expr?.result !== undefined) {
                type = expr.result.substr(1, expr.result.length - 2);
            }            
        }
        return type;
    }

    async getValue(expression: string): Promise<string | undefined> {
        const result = await this.evaluate(expression);
        return result?.type ? result.result : undefined;
    }

    async getValueAndType(expression: string): Promise<[string, string] | undefined> {
        const expr = await this.evaluate(expression);
        const value = expr?.result;
        let type = expr?.type;
        // TODO: checking for language each time is quite heavy,
        //       it could be done once when the session starts
        if (type === 'object' && this.language() === Language.JavaScript) {
            const expr = await this.evaluate('(' + expression + ').constructor.name');
            if (expr?.type !== undefined && expr?.result !== undefined) {
                type = expr.result.substr(1, expr.result.length - 2);
            }
        }
        return type !== undefined && value !== undefined ? [value, type] : undefined;
    }

    async evaluate(expression: string) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        const frameId = this.sessionInfo.frameId;
        return await this._evaluate(session, expression, frameId);
    }

    async variables(variablesReference:number, count: number | undefined = undefined) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        const frameId = this.sessionInfo.frameId;
        return await this._variables(session, variablesReference, count);
    }

    async readMemory(memoryReference: string, offset: number, count: number) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        let readMemoryArgs : DebugProtocol.ReadMemoryArguments = { memoryReference: memoryReference, offset: offset, count: count };
        return await session.customRequest('readMemory', readMemoryArgs);
    }

    async readMemoryBuffer(memoryReference: string, offset: number, count: number) {
        let mem = await this.readMemory(memoryReference, offset, count);
        if (mem && mem.data)
            return Buffer.from(mem.data, 'base64');
        else
            return undefined;
    }

    private sessionInfo: SessionInfo | undefined = undefined;
}
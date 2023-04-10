import * as vscode from 'vscode';
import * as util from './util'
import { DebugProtocol } from 'vscode-debugprotocol';

export class SessionInfo {
    constructor(
        public session: vscode.DebugSession,
        public threadId: number,
        public frameId: number)
    {
        this.language = this._getLanguage();
        this.context = this._getContext();
        this.debugger = this._getDebugger();
    }

    private _getLanguage(): Language | undefined {
        const sessionType = this.session.type;
        if (sessionType === undefined)
            return undefined;
        if (['cppvsdbg', 'cppdbg', 'lldb', 'cortex-debug'].includes(sessionType))
            return Language.Cpp;
        else if (['python', 'Python Kernel Debug Adapter'].includes(sessionType))
            return Language.Python;
        else if (['node', 'chrome', 'msedge', 'pwa-node', 'pwa-chrome', 'pwa-msedge'].includes(sessionType))
            return Language.JavaScript;
        else if (sessionType === 'java')
            return Language.Java;
        else if (sessionType === 'rdbg')
            return Language.Ruby;
        else
            return undefined;
    }

    private _getContext(): string | undefined {
        const sessionType = this.session.type;
        if (sessionType === 'rdbg')
            return 'watch';
        else
            return undefined; 
    }

    private _getDebugger(): string | undefined {
        const sessionType = this.session.type;
        if (sessionType !== undefined && this.language === Language.Cpp) {
            if (sessionType === 'cppvsdbg')
                return 'vsdbg';
            else if (sessionType === 'cppdbg') {
                if (this.session.configuration.MIMode === 'gdb')
                    return 'gdb';
                else if (this.session.configuration.MIMode === 'lldb')
                    return 'lldb';
            }
            else if (sessionType === 'lldb')
                return 'lldb';
            else if (sessionType === 'cortex-debug')
                return 'gdb';
        }
        return undefined;
    }

    public language: Language | undefined;
    public debugger: string | undefined;
    public context: string | undefined;    
}

export enum Endianness { Little, Big };

export class MachineInfo {
    constructor(
        public pointerSize: number,
        public endianness: Endianness)
    {}
}

export enum Language { Cpp, Java, JavaScript, Python, Ruby };

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
                                if (threadId !== undefined) {
                                    const frameId = await this._frameId(session, threadId);
                                    if (frameId != undefined) {
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
        this._machineInfo = undefined;
        if (this.sessionInfo) {
            this.sessionInfo = undefined;
            this._onUnavailable.fire();
        }
    }

    private async _customRequest(session: vscode.DebugSession, command: string, args: any) {
        try {
            return await session.customRequest(command, args);
        } catch (error) {
            return undefined;
        }
    }

    private async _frameId(session: vscode.DebugSession, threadId: number) {
        const stackArgs: DebugProtocol.StackTraceArguments = { threadId: threadId, startFrame: 0, levels: 1 };
        const stackTrace = await this._customRequest(session, 'stackTrace', stackArgs);
        if (stackTrace && stackTrace.stackFrames && stackTrace.stackFrames.length > 0) {
            const frame = stackTrace.stackFrames[0] as DebugProtocol.StackFrame;
            return frame.id;
        } else {
            return undefined;
        }
    }

    private async _evaluate(session: vscode.DebugSession, expression: string, frameId: number, context: string | undefined) {
        let exprArgs : DebugProtocol.EvaluateArguments = { expression: expression, frameId: frameId };
        if (context !== undefined)
            exprArgs.context = context;
        return await this._customRequest(session, 'evaluate', exprArgs);
    }

    private async _variables(session: vscode.DebugSession, variablesReference:number, count: number | undefined) {
        const exprArgs : DebugProtocol.VariablesArguments = { variablesReference: variablesReference, count: count };
        return await this._customRequest(session, 'variables', exprArgs);
    }

    private async _getMachineInfo(): Promise<MachineInfo | undefined> {
        if (this.sessionInfo === undefined)
            return undefined;
        if (this.sessionInfo.language === Language.Cpp) {
            const session = this.sessionInfo.session;
            const frameId = this.sessionInfo.frameId;
            const context = this.sessionInfo.context;
            //const expr1 = await this._evaluate(session, '(unsigned int)((unsigned char)-1)', frameId, context);
            const expr2 = await this._evaluate(session, 'sizeof(void*)', frameId, context);
            if (expr2 === undefined || expr2.type === undefined)
                return undefined;
            let pointerSize: number = 0;
            if (expr2.result === '4')
                pointerSize = 4;
            else if (expr2.result === '8')
                pointerSize = 8;
            else
                return undefined;
            const expr3 = await this._evaluate(session, 'sizeof(unsigned long)', frameId, context);
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
            const expr4 = await this._evaluate(session, expression, frameId, context);
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

    isStopped() : boolean {
        return this.sessionInfo !== undefined;
    }

    language(): Language | undefined {
        if (this.sessionInfo === undefined)
            return undefined;
        return this.sessionInfo.language;
    }

    async machineInfo(): Promise<MachineInfo | undefined> {
        if (this._machineInfo === undefined)
            this._machineInfo = await this._getMachineInfo();
        return this._machineInfo;
    }

    workspaceFolder(): string | undefined {
        if (this.sessionInfo === undefined)
            return undefined;
        return this.sessionInfo.session.workspaceFolder?.uri.fsPath;
    }

    private _isPythonError(type: string): boolean {
        return (type === 'NameError' || type === 'AttributeError') && this.sessionInfo?.language === Language.Python;
    }

    private _isRubyError(type: string): boolean {
        return (type === 'NameError' || type === 'NoMethodError') && this.sessionInfo?.language === Language.Ruby;
    }

    private _isJSObject(type: string): boolean {
        return type === 'object' && this.sessionInfo?.language === Language.JavaScript;
    }

    rawType(type: string): string {
        if (this.sessionInfo?.language === Language.Cpp) {
            return util.cppRemoveTypeModifiers(type);
        }
        return type;
    }

    // type has to be raw type, without modifiers, refs and ptrs
    async unrollTypeAlias(type: string): Promise<string> {
        const debuggerName = this.sessionInfo?.debugger;
        if (debuggerName === 'gdb') {
            const evalResult = (await this.evaluate('-exec ptype /rmt ' + type))?.result;
            let typeInfo: string = typeof evalResult === 'string' ? evalResult.trim() : '';
            if (typeInfo.startsWith('type = ')) {
                // console.log(typeInfo);
                typeInfo = typeInfo.substring(7);
                if (typeInfo.startsWith('class ')) {
                    typeInfo = typeInfo.substring(6);
                }
                else if (typeInfo.startsWith('struct ')) {
                    typeInfo = typeInfo.substring(7);
                }
                else if (typeInfo.startsWith('union ')) {
                    typeInfo = typeInfo.substring(6);
                }
                else if (typeInfo.startsWith('enum class ')) {
                    typeInfo = typeInfo.substring(11);
                }
                else if (typeInfo.startsWith('enum ')) {
                    typeInfo = typeInfo.substring(5);
                }
                return util.cppType(typeInfo);
            }
        }
        else if (debuggerName === 'lldb') {
            const typeInfo = (await this.evaluate('image lookup --type "' + type + '"', '_command'))?.result;
            if (typeof typeInfo === 'string') {
                const begin = typeInfo.indexOf('qualified = "');
                if (begin >= 0) {
                    const end = typeInfo.indexOf('"', begin + 13);
                    if (end >= 0) {
                        return typeInfo.substring(begin + 13, end);
                    }
                }
            }
        }

        return type;
    }

    async getType(expression: string): Promise<string | undefined> {
        let type = (await this.evaluate(expression))?.type;
        if (this._isPythonError(type))
            return undefined;
        if (this._isRubyError(type))
            return undefined;
        if (this._isJSObject(type)) {
            const expr = await this.evaluate('(' + expression + ').constructor.name');
            if (expr?.type !== undefined && expr?.result !== undefined) { // type === 'string'?
                type = expr.result.substr(1, expr.result.length - 2);
            }            
        }
        return type;
    }

    // NOTE: In LLDB members of cv types are also cv while in GDB they are not
    //   This function can be used to consistently get types without modifiers
    async getRawType(expression: string): Promise<string | undefined> {
        const type = await this.getType(expression);
        return type !== undefined ? this.rawType(type) : undefined;
    }

    async getValue(expression: string): Promise<string | undefined> {
        const result = await this.evaluate(expression);
        if (this._isPythonError(result?.type))
            return undefined;
        if (this._isRubyError(result?.type))
            return undefined;
        return result?.type ? result.result : undefined;
    }

    async getValueAndType(expression: string): Promise<[string, string] | undefined> {
        const expr = await this.evaluate(expression);
        const value = expr?.result;
        let type = expr?.type;
        if (this._isPythonError(type))
            return undefined;
        if (this._isRubyError(type))
            return undefined;
        if (this._isJSObject(type)) {
            const expr = await this.evaluate('(' + expression + ').constructor.name');
            if (expr?.type !== undefined && expr?.result !== undefined) { // type === 'string'?
                type = expr.result.substr(1, expr.result.length - 2);
            }
        }
        return type !== undefined && value !== undefined ? [value, type] : undefined;
    }

    // NOTE: In LLDB members of cv types are also cv while in GDB they are not
    //   This function can be used to consistently get types without modifiers
    async getValueAndRawType(expression: string): Promise<[string, string] | undefined> {
        const result = await this.getValueAndType(expression);
        if (result !== undefined) {
            result[1] = this.rawType(result[1]);
        }
        return result;
    }

    async getAddress(expression: string): Promise<string | undefined> {
        if (this.sessionInfo?.language === Language.Cpp) {
            return await this.getValue("&(" + expression + ")");
        }
        return undefined;
    }

    async getSize(expression: string): Promise<number | undefined> {
        if (this.sessionInfo?.language === Language.Cpp) {
            const resultStr = await this.getValue("sizeof(" + expression + ")");
            if (resultStr === undefined)
                return undefined;
            const result = Number.parseInt(resultStr);
            if (Number.isNaN(result))
                return undefined;
            return result;
        }
        return undefined;
    }

    async evaluate(expression: string, context: string | undefined = undefined) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        const frameId = this.sessionInfo.frameId;
        if (context === undefined)
            context = this.sessionInfo.context;
        return await this._evaluate(session, expression, frameId, context);
    }

    async variables(variablesReference:number, count: number | undefined = undefined) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        return await this._variables(session, variablesReference, count);
    }

    async readMemory(memoryReference: string, offset: number, count: number) {
        if (this.sessionInfo === undefined)
            return undefined;
        const session = this.sessionInfo.session;
        let readMemoryArgs : DebugProtocol.ReadMemoryArguments = { memoryReference: memoryReference, offset: offset, count: count };
        return await this._customRequest(session, 'readMemory', readMemoryArgs);
    }

    async readMemoryBuffer(memoryReference: string, offset: number, count: number) {
        let mem = await this.readMemory(memoryReference, offset, count);
        if (mem && mem.data)
            return Buffer.from(mem.data, 'base64');
        else
            return undefined;
    }

    private sessionInfo: SessionInfo | undefined = undefined;
    private _machineInfo: MachineInfo | undefined = undefined;
}
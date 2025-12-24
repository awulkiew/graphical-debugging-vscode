import * as vscode from 'vscode';
import * as util from './util'
import { DebugProtocol } from 'vscode-debugprotocol';

export enum Language { Cpp, CSharp, Java, JavaScript, Python, Ruby };

export class SessionInfo {
    constructor(
        public session: vscode.DebugSession,
        public threadId: number,
        public frameId: number)
    {
        // TODO: calculate these lazily
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
        else if (['coreclr'].includes(sessionType))
            return Language.CSharp;
        else if (['java'].includes(sessionType))
            return Language.Java;
        else if (['node', 'chrome', 'msedge', 'pwa-node', 'pwa-chrome', 'pwa-msedge'].includes(sessionType))
            return Language.JavaScript;
        else if (['python', 'debugpy', 'Python Kernel Debug Adapter'].includes(sessionType))
            return Language.Python;
        else if (['rdbg'].includes(sessionType))
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
        this._machineInfo = undefined
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

    isStopped() : boolean {
        return this.sessionInfo !== undefined;
    }

    language(): Language | undefined {
        if (this.sessionInfo === undefined)
            return undefined;
        return this.sessionInfo.language;
    }

    workspaceFolder(): string | undefined {
        if (this.sessionInfo === undefined)
            return undefined;
        return this.sessionInfo.session.workspaceFolder?.uri.fsPath;
    }

    private _isPythonError(type: string): boolean {
        return (type === 'NameError' || type === 'AttributeError' || type === 'TypeError') && this.sessionInfo?.language === Language.Python;
    }

    private _isRubyError(type: string): boolean {
        return (type === 'NameError' || type === 'NoMethodError') && this.sessionInfo?.language === Language.Ruby;
    }

    private _isJSObject(type: string): boolean {
        return type === 'object' && this.sessionInfo?.language === Language.JavaScript;
    }

    numericType(type: string): string {
        if (this.sessionInfo?.language === Language.Cpp) {
            return util.cppRemoveCV(type);
        }
        return type;
    }

    rawType(type: string): string {
        if (this.sessionInfo?.language === Language.Cpp) {
            return util.cppRemoveCVPtrRef(type);
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

    async getNumericType(expression: string): Promise<string | undefined> {
        const type = await this.getType(expression);
        return type !== undefined ? this.numericType(type) : undefined;
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

    public async machineInfo(): Promise<MachineInfo | undefined> {
        if (this._machineInfo === undefined) {
            this._machineInfo = await this._evaluateMachineInfo();
        }
        return this._machineInfo;
    }

    private async _evaluateMachineInfo() {
        if (this.sessionInfo === undefined)
            return undefined;
        if (this.sessionInfo.language === Language.Cpp) {
            const session = this.sessionInfo.session;
            const frameId = this.sessionInfo.frameId;
            const context = this.sessionInfo.context;
            //const expr1 = await this._evaluate(session, '(unsigned int)((unsigned char)-1)', frameId, context);
            const expr2 = await this._evaluate(session, 'sizeof(void*)', frameId, context);
            if (expr2?.type === undefined)
                return undefined;
            let pointerSize: number = 0;
            if (expr2.result === '4')
                pointerSize = 4;
            else if (expr2.result === '8')
                pointerSize = 8;
            else
                return undefined;
            const expr3 = await this._evaluate(session, 'sizeof(unsigned long)', frameId, context);
            if (expr3?.type === undefined)
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
            if (expr4?.type === undefined)
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

    async sizeOf(typeOrValue: string) : Promise<number | undefined> {
        let sizeStr = "";
        if (this.language() === Language.Cpp) {
            const expr = await this.evaluate('sizeof(' + typeOrValue + ')');
            if (expr === undefined || expr.type === undefined) {
                return undefined;
            }
            sizeStr = expr.result;
        }
        else {
            return undefined;
        }
        const val = parseInt(sizeStr);
        return Number.isNaN(val) ? undefined : val;
    }

    async cppIsSignedInt(intType : string) : Promise<boolean | undefined> {
        const expr = await this.evaluate('(int)(' + intType + ')-1');
        if (expr?.type === undefined)
            return undefined;
        const val = parseInt(expr.result);
        if (Number.isNaN(val))
            return undefined;
        if (val === -1)
            return true;
        else
            return false;
    }

    private sessionInfo: SessionInfo | undefined = undefined;
    private _machineInfo: MachineInfo | undefined = undefined;
}

export enum Endianness { Little, Big };

export class MachineInfo {
    constructor(
        public pointerSize: number,
        public endianness: Endianness)
    {}

    readPointer(buffer: Buffer, offset?: number): bigint {
        if (this.pointerSize == 4) {
            return this.endianness === Endianness.Little
                 ? BigInt(buffer.readUInt32LE(offset))
                 : BigInt(buffer.readUInt32BE(offset));
        }
        else { // this.pointerSize == 8
            return this.endianness === Endianness.Big
                 ? buffer.readBigUInt64LE(offset)
                 : buffer.readBigUInt64BE(offset);
        }
    }

    readPointerStr(buffer: Buffer, offset?: number): string {
        const val = this.readPointer(buffer, offset);
        const str  = val.toString(16);
        return str.startsWith("0x") || str.startsWith("0X")
             ? str : "0x" + str;
    }

    readDouble(buffer: Buffer, offset?: number): number {
        return this.endianness === Endianness.Little
             ? buffer.readDoubleLE(offset)
             : buffer.readDoubleBE(offset);
    }
    readFloat(buffer: Buffer, offset?: number): number {
        return this.endianness === Endianness.Little
             ? buffer.readFloatLE(offset)
             : buffer.readFloatBE(offset);
    }
    // 1 <= byteLength <= 6
    readInt(buffer: Buffer, byteLength: number, offset?: number): number {
        return this.endianness === Endianness.Little
             ? buffer.readIntLE(offset ? offset : 0, byteLength)
             : buffer.readIntBE(offset ? offset : 0, byteLength);
    }
    // 1 <= byteLength <= 6
    readUInt(buffer: Buffer, byteLength: number, offset?: number): number {
        return this.endianness === Endianness.Little
             ? buffer.readUIntLE(offset ? offset : 0, byteLength)
             : buffer.readUIntBE(offset ? offset : 0, byteLength);
    }
    readInt64(buffer: Buffer, offset?: number): bigint {
        return this.endianness === Endianness.Little
             ? buffer.readBigInt64LE(offset)
             : buffer.readBigInt64BE(offset);
    }
    readUInt64(buffer: Buffer, offset?: number): bigint {
        return this.endianness === Endianness.Little
             ? buffer.readBigUInt64LE(offset)
             : buffer.readBigUInt64BE(offset);
    }
}

// TODO: or maybe return number | BigInt
// TODO: check if Plotly can even take BigInt

export class NumericReader {
    read(buffer: Buffer, offset?: number) : number | undefined {
        return undefined;
    }
}

export class DoubleReader extends NumericReader {
    constructor (private _machineInfo: MachineInfo) { super(); }
    read(buffer: Buffer, offset?: number) : number | undefined {
        return this._machineInfo.readDouble(buffer, offset);
    }
}

export class FloatReader extends NumericReader {
    constructor (private _machineInfo: MachineInfo) { super(); }
    read(buffer: Buffer, offset?: number) : number | undefined {
        return this._machineInfo.readFloat(buffer, offset);
    }
}

export class IntReader extends NumericReader {
    constructor (private _machineInfo: MachineInfo, private _byteLength: number) { super(); }
    read(buffer: Buffer, offset?: number) : number | undefined {
        if (this._byteLength >= 1 && this._byteLength <= 6) {
            return this._machineInfo.readInt(buffer, this._byteLength, offset);
        }
        else if (this._byteLength == 8) {
            return new Number(this._machineInfo.readInt64(buffer, offset)).valueOf();
        }
        return undefined;
    }
}

export class UIntReader extends NumericReader {
    constructor (private _machineInfo: MachineInfo, private _byteLength: number) { super(); }
    read(buffer: Buffer, offset?: number) : number | undefined {
        if (this._byteLength >= 1 && this._byteLength <= 6) {
            return this._machineInfo.readUInt(buffer, this._byteLength, offset);
        }
        else if (this._byteLength == 8) {
            return new Number(this._machineInfo.readUInt64(buffer, offset)).valueOf();
        }
        return undefined;
    }
}

const cppSignedIntTypes = new Set<string>([
    // std
    'signed char',
    'short', 'short int', 'signed short', 'signed short int',
    'int', 'signed', 'signed int',
    'long', 'long int', 'signed long', 'signed long int',
    'long long', 'long long int', 'signed long long', 'signed long long int',
    'ptrdiff_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'int_fast8_t', 'int_fast16_t', 'int_fast32_t', 'int_fast64_t',
    'int_least8_t', 'int_least16_t', 'int_least32_t', 'int_least64_t',
    'intmax_t', 'intptr_t',
    // cppvsdbg
    '__int8', '__int16', '__int32', '__int64'
]);

const cppUnsignedIntTypes = new Set<string>([
    // std
    'unsigned char',
    'unsigned short', 'unsigned short int',
    'unsigned', 'unsigned int',
    'unsigned long', 'unsigned long int',
    'unsigned long long', 'unsigned long long int',
    'size_t',
    'char16_t', 'char32_t',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'uint_fast8_t', 'uint_fast16_t', 'uint_fast32_t', 'uint_fast64_t',
    'uint_least8_t', 'uint_least16_t', 'uint_least32_t', 'uint_least64_t',
    'uintmax_t', 'uintptr_t',
    // cppvsdbg
    'unsigned __int8', 'unsigned __int16', 'unsigned __int32', 'unsigned __int64'
]);

const cppUnknownIntTypes = new Set<string>([
    // std
    'char'
]);

export async function numericReader(dbg: Debugger, expression: string) : Promise<NumericReader | undefined> {
    const mi = await dbg.machineInfo();
    if (mi === undefined) {
        return undefined;
    }
    const type = await dbg.getNumericType(expression);
    if (type === undefined) {
        return undefined;
    }
    if (dbg.language() === Language.Cpp) {
        if (type === "double" || type === "long double" && await dbg.sizeOf(type) === 8) {
            return new DoubleReader(mi);
        }
        else if (type === "float") {
            return new FloatReader(mi);
        }
        else if (cppSignedIntTypes.has(type) || cppUnknownIntTypes.has(type) && await dbg.cppIsSignedInt(type) === true) {
            const byteLength = await dbg.sizeOf(type);
            if (byteLength === undefined || byteLength < 1 || byteLength > 8) {
                return undefined;
            }
            return new IntReader(mi, byteLength);
        }
        else if (cppUnsignedIntTypes.has(type) || cppUnknownIntTypes.has(type) && await dbg.cppIsSignedInt(type) === false) {
            const byteLength = await dbg.sizeOf(type);
            if (byteLength === undefined || byteLength < 1 || byteLength > 8) {
                return undefined;
            }
            return new UIntReader(mi, byteLength);
        }
    }
    return undefined;
}
import * as debug from './debugger';
import * as draw from './drawable'
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

function parseTParams(type: string, beg: string = '<', end: string = '>', sep: string = ',') : string[] {
    let result: string[] = [];
    let param_list_index: number = 0;
    let index: number = 0;
    let param_first: number = -1;
    let param_last: number = -1;
    for (let c of type)
    {
        if (c === beg)
        {
            ++param_list_index;
        }
        else if (c === end)
        {
            if (param_last === -1 && param_list_index === 1)
                param_last = index;

            --param_list_index;
        }
        else if (c === sep)
        {
            if (param_last === -1 && param_list_index === 1)
                param_last = index;
        }
        else
        {
            if (param_first === -1 && param_list_index === 1)
                param_first = index;
        }

        if (param_first !== -1 && param_last !== -1)
        {
            while (param_first < param_last && type[param_first] === ' ')
                ++param_first;
            while (param_first < param_last && type[param_last - 1] === ' ')
                --param_last;
            result.push(type.substr(param_first, param_last - param_first));
            param_first = -1;
            param_last = -1;
        }

        ++index;
    }
    return result;
}

// function parseSubscripts(type: string, beg: string = '[', end: string = ']') : string[] {
//     let result: string[] = [];
//     // TODO:    
//     return result;
// }


export class Variable {
    constructor(
        public name: string,
        public type: string
    ) {}

    tparam(i: number): string {
        if (this._tparams === undefined)
            this._tparams = parseTParams(this.type);
        return i < this._tparams.length ? this._tparams[i] : '';
    }
    // TODO: support 2d arrays [1][2]
    // parseSubscripts
    nparam(i: number): string {
        if (this._nparams === undefined)
            this._nparams = parseTParams(this.type, '[', ']');
        return i < this._nparams.length ? this._nparams[i] : '';
    }

    private _tparams: string[] | undefined;
    private _nparams: string[] | undefined;
}


interface IExpressionPart {
    toString(variable: Variable): string;
}
class ExpressionString implements IExpressionPart {
    constructor(private _str: string) {}
    toString(variable: Variable): string { return this._str; }
}
class ExpressionThis implements IExpressionPart {
    toString(variable: Variable): string { return '(' + variable.name + ')'; }
}
class ExpressionNParam implements IExpressionPart {
    constructor(protected _i: number) {}
    toString(variable: Variable): string { return variable.nparam(this._i); }
}
class ExpressionTParam extends ExpressionNParam {
    toString(variable: Variable): string { return variable.tparam(this._i); }
}
class ExpressionType implements IExpressionPart {
    toString(variable: Variable): string { return variable.type; }
}
export class Expression
{
    constructor(expression: string) {
        const regexp = new RegExp('\\$[A-Za-z_]\\w*', 'g');
        let matches = expression.matchAll(regexp);
        let index = 0;
        for (const match of matches) {
            if (match.index !== undefined) {
                if (match.index > index) {
                    this._parts.push(new ExpressionString(expression.substr(index, match.index - index)));
                    index = match.index;
                }
                
                if (match[0] === '$this') {
                    this._parts.push(new ExpressionThis());
                    index = match.index + 5;
                }
                else if (match[0] === '$T') {
                    this._parts.push(new ExpressionType());
                    index = match.index + 2;
                }
                else if (match[0].startsWith('$T')) {
                    this._parts.push(new ExpressionTParam(parseInt(match[0].substr(2))));
                    index = match.index + match[0].length;
                }
                else if (match[0].startsWith('$N')) {
                    this._parts.push(new ExpressionNParam(parseInt(match[0].substr(2))));
                    index = match.index + match[0].length;
                }
            }
        }
        if (index < expression.length) {
            this._parts.push(new ExpressionString(expression.substr(index)));
        }
    }

    toString(variable: Variable): string {
        let result: string = '';
        for (let part of this._parts) {
            result += part.toString(variable);            
        }
        // TODO: do this only for C++ ?
        // It is possible that this should depend on the debugger
        return this._addSpaces(result);
    }

    private _addSpaces(str: string): string {
        let result = '';
        let p = '';
        for (let c of str) {
            if (c === '>') {
                if (p === '>')
                    result += ' >';
                else
                    result += '>';
            }
            else
                result += c;
            p = c;
        }
        return result;
    }

    private _parts : IExpressionPart[] = [];
}


class EvaluatedExpression {
    constructor(
        public expression: Expression,
        public name: string,
        public type: string
    ) {}

    get variable(): Variable { return new Variable(this.name, this.type); }
}

async function evaluateExpression(dbg: debug.Debugger, variable: Variable, expression: string): Promise<EvaluatedExpression | undefined> {
	const expr = new Expression(expression);
	const str = expr.toString(variable);
	const vt = await dbg.getValueAndType(str);
    return vt !== undefined ? new EvaluatedExpression(expr, str, vt[1]) : undefined;
}

// Various Containers

export class Container {
    element(variable: Variable): string | undefined {
        return undefined;
    }
    async size(dbg: debug.Debugger, variable: Variable): Promise<number> {
        return 0;
    }
    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {}
}

export class RandomAccessContainer extends Container {}

export class ContiguousContainer extends RandomAccessContainer {}

export class Array extends ContiguousContainer
{
    constructor(private _start: Expression, private _size: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        return '(' + this._start.toString(variable) + ')[0]';
    }

    async size(dbg: debug.Debugger, variable: Variable): Promise<number> {
        const sizeStr = this._size.toString(variable);
        // TODO: Check if it's possible to parse size at this point
        const sizeVal = await dbg.getValue(sizeStr);
        return sizeVal !== undefined ? parseInt(sizeVal) : 0;
    }

    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {
        const size = await this.size(dbg, variable);
        if (! (size > 0)) // also handle NaN
            return;
        // NOTE: This loop could be done asynchroniously with await Promise.all()
        //   but an array can potentially store great number of objects so there
        //   would be great number of promises. And it will not be possible to
        //   end fast in case of error because the program would wait for all.
        for (let i = 0; i < size; ++i) {
            const elStr = '(' + this._start.toString(variable) + ')[' + i.toString() + ']';
            yield elStr;
        }
    }
}

export class DArray extends RandomAccessContainer {
    constructor(private _start: Expression, private _finish: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        return '(' + this._start.toString(variable) + ')[0]';
    }

    async size(dbg: debug.Debugger, variable: Variable): Promise<number> {
        const sizeStr = '(' + this._finish.toString(variable) + ')-(' + this._start.toString(variable) + ')';
        const sizeVal = await dbg.getValue(sizeStr);
        return sizeVal !== undefined ? parseInt(sizeVal) : 0;
    }

    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {
        const size = await this.size(dbg, variable);
        if (! (size > 0)) // also handle NaN
            return;
        for (let i = 0; i < size; ++i) {
            const elStr = '(' + this._start.toString(variable) + ')[' + i.toString() + ']';
            yield elStr;
        }
    }
}

// TODO: Later when direct memory access is implemented allow passing pointers
export class LinkedList extends Container
{
    constructor(
        private _size: Expression,
        private _head: Expression,
        private _next: Expression,
        private _value: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        const headName = '(' + this._head.toString(variable) + ')';
        // TEMP: The original type is used by expression to get Tparams, not the head's type
        //       Variable should be renamed or replaced with something in expression.toString()
        const headVar = new Variable(headName, variable.type);
        return this._value.toString(headVar);
    }

    async size(dbg: debug.Debugger, variable: Variable): Promise<number> {
        const sizeStr = this._size.toString(variable);
        // TODO: Check if it's possible to parse size at this point
        const sizeVal = await dbg.getValue(sizeStr);
        return sizeVal !== undefined ? parseInt(sizeVal) : 0;
    }

    async *elements(dbg: debug.Debugger, variable: Variable): AsyncGenerator<string, void, unknown> {
        const size = await this.size(dbg, variable);
        if (! (size > 0)) // also handle NaN
            return;
        
        const headName = '(' + this._head.toString(variable) + ')';
        // TEMP: The original type is used by expression to get Tparams, not the node's type
        let nodeVar = new Variable(headName, variable.type);
        for (let i = 0; i < size; ++i) {
            const elStr = '(' + this._value.toString(nodeVar) + ')';
            yield elStr;
            nodeVar.name = '(' + this._next.toString(nodeVar) + ')';
        }
    }
}

// Unit

export enum Unit { None, Degree, Radian };

// Value

export class Value {
    constructor(private _name: Expression) {
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<number | undefined> {
        const valStr = this._name.toString(variable);
        const valVal = await dbg.getValue(valStr);
        return valVal !== undefined ? parseFloat(valVal) : undefined;
    }
}

// Base Loader

export class Loader {
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        return undefined;
    }
}

// Containers of drawables

export class ContainerLoader extends Loader {}

export class Numbers extends ContainerLoader {
    constructor(private _container: Container) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let ys: number[] = [];
        for await (let elStr of this._container.elements(dbg, variable)) {
            const elVal = await dbg.getValue(elStr);
            if (elVal === undefined)
                return undefined;
            const el = parseFloat(elVal);
            ys.push(el);
        }
        return new draw.Plot(undefined, ys, draw.System.None);
    }
}

export class Values extends ContainerLoader {
    constructor(private _container: Container, private _value: Value) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const elStr = this._container.element(variable);
        if (elStr === undefined)
            return undefined;
        const elType = await dbg.getType(elStr);
        if (elType === undefined)
            return undefined;
        let ys: number[] = [];
        let v = new Variable(elStr, elType);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const n = await this._value.load(dbg, v);
            if (n === undefined)
                return undefined
            ys.push(n);
        }
        return new draw.Plot(undefined, ys, draw.System.None);
    }
}

export class Points extends ContainerLoader {
    constructor(private _container: Container, private _point: Point) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const elStr = this._container.element(variable);
        if (elStr === undefined)
            return undefined;
        const elType = await dbg.getType(elStr);
        if (elType === undefined)
            return undefined;
        let xs: number[] = [];
        let ys: number[] = [];
        let v = new Variable(elStr, elType);
        let system = draw.System.None;
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const point = await this._point.load(dbg, v);
            if (point === undefined)
                return undefined;
            const p = point as draw.Point;
            xs.push(p.x)
            ys.push(p.y);
            system = p.system;
        }
        return new draw.Plot(xs, ys, system);
    }
}

export class Geometries extends ContainerLoader {
    constructor(private _container: Container, private _geometry: Geometry) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const elStr = this._container.element(variable);
        if (elStr === undefined)
            return undefined;
        const elType = await dbg.getType(elStr);
        if (elType === undefined)
            return undefined;
        let drawables: draw.Drawable[] = [];
        let v = new Variable(elStr, elType);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const d = await this._geometry.load(dbg, v);
            if (d === undefined)
                return undefined;
            drawables.push(d);
        }
        return new draw.Drawables(drawables);
    }
}

// Geometric primitives

export class Geometry extends Loader {
}

export class Point extends Geometry {
    constructor(
        private _xEval: EvaluatedExpression,
        private _yEval: EvaluatedExpression,
        private _system: draw.System,
        private _unit: Unit) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const xStr = this._xEval.expression.toString(variable);
        const xVal = await dbg.getValue(xStr);
        if (xVal === undefined)
            return undefined;
        const yStr = this._yEval.expression.toString(variable);
        const yVal = await dbg.getValue(yStr);
        if (yVal === undefined)
            return undefined;
        let x = parseFloat(xVal);
        let y = parseFloat(yVal);
        // Convert radians to degrees if needed
        if (this._unit === Unit.Radian) {
            const r2d = 180 / Math.PI;
            x *= r2d;
            y *= r2d;
        }
        return new draw.Point(x, y, this._system);
    }
}

export class PointsRange extends Geometry {
    constructor(private _containerExpr: EvaluatedExpression) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        if (this._pointsLoad === undefined) {
            // TODO: only search for Container of Points 
            const loader = await getLoader(dbg, contVar);
            if (loader instanceof Points)
                this._pointsLoad = loader as Points;
        }
        return this._pointsLoad?.load(dbg, contVar);
    }
    private _pointsLoad: Points | undefined = undefined;
}

export class Segment extends Geometry {
    constructor(private _p0Expr: EvaluatedExpression,
                private _p1Expr: EvaluatedExpression) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const p0Str = this._p0Expr.expression.toString(variable);
        const p0Var = new Variable(p0Str, this._p0Expr.type);
        const p1Str = this._p1Expr.expression.toString(variable);
        const p1Var = new Variable(p1Str, this._p1Expr.type);
        if (this._p0Load === undefined) {
            // TODO: only search for Points
            const loader = await getLoader(dbg, p0Var);
            if (loader instanceof Point)
                this._p0Load = loader as Point;
        }
        if (this._p1Load === undefined) {
            // TODO: only search for Points
            const loader = await getLoader(dbg, p1Var);
            if (loader instanceof Point)
                this._p1Load = loader as Point;
        }
        const p0 = await this._p0Load?.load(dbg, p0Var) as draw.Point;
        const p1 = await this._p1Load?.load(dbg, p1Var) as draw.Point;
        if (p0 == undefined || p1 === undefined)
            return undefined;
        return new draw.Plot([p0.x, p1.x], [p0.y, p1.y], p0.system);
    }
    private _p0Load: Point | undefined = undefined;
    private _p1Load: Point | undefined = undefined;
}

export class Linestring extends PointsRange {
    constructor(containerExpr: EvaluatedExpression) {
        super(containerExpr);
    }
}

export class Ring extends PointsRange {
    constructor(containerExpr: EvaluatedExpression) {
        super(containerExpr);
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const plot = await super.load(dbg, variable);
        if (plot instanceof draw.Plot && plot.xs)
            return new draw.Ring(plot.xs, plot.ys, plot.system);
        else
            return undefined;
    }
}

export class MultiPoint extends PointsRange {
    constructor(containerExpr: EvaluatedExpression) {
        super(containerExpr);
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const plot = await super.load(dbg, variable);
        if (plot instanceof draw.Plot)
            plot.plotStyle = draw.PlotStyle.Markers;
        return plot;
    }
}

export class Polygon extends Geometry {
    constructor(
        private _extEval: EvaluatedExpression,
        private _intEval: EvaluatedExpression | undefined) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const extStr = this._extEval.expression.toString(variable);
        const extVar = new Variable(extStr, this._extEval.type);
        if (this._extLoad === undefined) {
            // TODO: only search for Ring
            const loader = await getLoader(dbg, extVar);
            if (loader instanceof Ring)
                this._extLoad = loader;
        }
        if (this._extLoad === undefined)
            return undefined;
        const extRing = await this._extLoad.load(dbg, extVar);
        if (!(extRing instanceof draw.Ring))
            return undefined;
        if (this._intEval === undefined)
            return new draw.Polygon(extRing)
        // TODO: Get Container loader and check the size here to avoid
        //       accessing element of empty container.
        const intStr = this._intEval.expression.toString(variable);
        const intVar = new Variable(intStr, this._intEval.type);
        if (this._intLoad === undefined) {
            // TODO: only search for Geometries or containers of Ring
            const loader = await getLoader(dbg, intVar);
            if (loader instanceof Geometries)
                this._intLoad = loader;
        }
        if (this._intLoad === undefined) {
            // TEMP: Possible reason for this is that Container is returned
            //       instead of Geometries above if size of Container is 0
            //       and it is not possible to access the first element to get
            //       the loader for elements.
            //       So for now instead of returning undefined here assume this is
            //       the case and return only the exterior ring.
            return new draw.Polygon(extRing);
            //return undefined;
        }
        const intRings = await this._intLoad.load(dbg, intVar);
        if (!(intRings instanceof draw.Drawables))
            return undefined;
        // Would it be possible to cast drawables to Ring[] instead of creating new array?
        let rings: draw.Ring[] = [];
        for (let d of intRings.drawables) {
            if (!(d instanceof draw.Ring))
                return undefined;
            rings.push(d as draw.Ring);
        }
        return new draw.Polygon(extRing, rings);
    }

    private _extLoad: Ring | undefined = undefined;
    private _intLoad: Geometries | undefined = undefined;
}

export class GeometryCollection extends ContainerLoader {
    constructor(private _container: Container) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let drawables: draw.Drawable[] = [];        
        for await (let elStr of this._container.elements(dbg, variable)) {
            const elType = await dbg.getType(elStr);
            if (elType === undefined)
                return undefined;
            const v = new Variable(elStr, elType);
            let elLoad = this._loaders.get(elType);
            if (elLoad === undefined) {
                elLoad = await getLoader(dbg, v);
                if (elLoad === undefined)
                    return undefined;    
                this._loaders.set(elType, elLoad);
            }
            const d = await elLoad.load(dbg, v);
            if (d === undefined)
                return undefined;
            drawables.push(d);
        }
        return new draw.Drawables(drawables);
    }

    private _loaders: Map<string, Geometry> = new Map<string, Geometry>();
}

export class Types {

    *match(type: string, lang: debug.Language, kinds: string[] | undefined = undefined) {
        for (const entry of this.get(lang, kinds))
            if (type.match('^' + entry.type + '$'))
                yield entry;
    }

    *get(lang: debug.Language, kinds: string[] | undefined = undefined) {
        for (const type of this._get(this._languages, lang, kinds))
            yield type;
        for (const type of this._get(this._languagesUD, lang, kinds))
            yield type;
    }

    private *_get(map: Map<debug.Language, Map<string, any[]>>, language: debug.Language, kinds: string[] | undefined = undefined) {
        if (language === undefined)
            return;
        const ks = map.get(language);
        if (ks === undefined)
            return;
        if (kinds === undefined) {
            for (const k of ks) {
                for (const t of k[1]) {
                    yield t;
                }
            }
        } else {
            for (const kind of kinds) {
                const k = ks.get(kind);
                if (k !== undefined) {
                    for (const t of k) {
                        yield t;
                    }
                }
            }
        }
    }

    // TODO: update separate files only if needed
    // TODO: load language files only if they match currently debugged language
    update(dbg: debug.Debugger) {
        {
            const p = path.join(__filename, '..', '..', 'resources');
            const files = this._jsonFiles(p, this._files);
            if (files[1]) { // modified
                this._languages.clear();
                this._parseLanguages(files[0], this._languages);
            }
        }
        {
            let dir = vscode.workspace.getConfiguration().get<string>('graphicalDebugging.additionalTypesDirectory');
            let p: string | undefined = undefined;
            if (dir?.startsWith('.')) {
                const workspaceDir = dbg.workspaceFolder();
                if (workspaceDir)
                    p = path.join(workspaceDir, dir);
            }
            else {
                p = dir;
            }
            if (p !== undefined) {
                const files = this._jsonFiles(p, this._filesUD);
                if (files[1]) { // modified
                    this._languagesUD.clear();
                    this._parseLanguages(files[0], this._languagesUD);
                }
            }
        }
    }

    private _parseLanguages(filePaths: string[],
                            languages: Map<debug.Language, Map<string, any[]>>) {
        const files = this._parseFiles(filePaths);
        for (const file of files) {
            const lang = this._stringToLanguage(file.language);
            if (lang === undefined)
                continue;
            if (! languages.has(lang))
                languages.set(lang, new Map<string, any[]>());
            let language = languages.get(lang);
            if (language === undefined) // silence TS
                continue;
            for (const type of file.types) {
                if (type.kind === undefined)
                    continue;
                if (! language.has(type.kind))
                    language.set(type.kind, []);
                let kind = language.get(type.kind);
                if (kind === undefined) // silence TS
                    continue;
                kind.push(type);
            }
        }
    }

    // Parse list of files
    private _parseFiles(filePaths: string[]): any[] {
        let result: any[] = [];
        for (const filePath of filePaths) {
            try {
                // TODO: In order to quickly check json files ideally
                //       only the top level should be read and parsed.
                const f = fs.readFileSync(filePath, 'utf-8');
                const o = JSON.parse(f);
                if (o.name === 'graphicaldebugging') {
                    result.push(o);
                }
            } catch(err) {}
        }
        return result;
    }

    // Return list of json files in directory and a flag indicating whether any of them was modified
    private _jsonFiles(directoryPath: string, filePathsMap: Map<string, number>): [string[], boolean] {
        let result: any[] = [];
        let modified = false;
        let fileNames: string[] = [];
        try {
            fileNames = fs.readdirSync(directoryPath);
        } catch(err) {}
        for (const fileName of fileNames) {
            if (fileName.endsWith('.json')) {
                const p = path.join(directoryPath, fileName);
                let stat = undefined;
                try{
                    stat = fs.statSync(p);
                } catch(err) {}
                if (stat?.isFile()) {
                    result.push(p);
                    const mtime = (stat.mtime as Date).getTime();
                    const prevmtime = filePathsMap.get(p);
                    if (prevmtime === undefined || prevmtime !== mtime) {
                        filePathsMap.set(p, mtime);
                        modified = true;
                    }
                }
            }
        }
        return [result, modified];
    }

    private _stringToLanguage(name: string | undefined): debug.Language | undefined {
        switch(name){
            case 'cpp': return debug.Language.Cpp;
            case 'java': return debug.Language.Java;
            case 'javascript': return debug.Language.JavaScript;
            case 'python': return debug.Language.Python;
            default: return undefined;
        }
    }

    private _languages: Map<debug.Language, Map<string, any[]>> = new Map<debug.Language, Map<string, any[]>>();
    private _languagesUD: Map<debug.Language, Map<string, any[]>> = new Map<debug.Language, Map<string, any[]>>();
    private _files: Map<string, number> = new Map<string, number>();
    private _filesUD: Map<string, number> = new Map<string, number>();
}

export let types: Types = new Types();

// const nonContainers = ['value', 'point', 'linestring', 'ring', 'multipoint', 'polygon', 'multilinestring', 'multilipolygon'];
// const geometries = ['point', 'linestring', 'ring', 'multipoint', 'polygon', 'multilinestring', 'multilipolygon'];

// Return Container or Loader for Variable based on JSON definitions
export async function getLoader(dbg: debug.Debugger, variable: Variable): Promise<Loader | undefined> {
    const lang: debug.Language | undefined = dbg.language();
    if (lang === undefined)
        return undefined;

    for (const entry of types.match(variable.type, lang)) {
        if (entry.kind === 'container') {
            const container: Container | undefined = await _getContainer(dbg, variable, entry);
            if (container) {
                const elemStr = container.element(variable);
                if (elemStr) {
                    const elemType = await dbg.getType(elemStr);
                    if (elemType !== undefined) {
                        const elemVar = new Variable(elemStr, elemType);
                        // TODO: only search for non-containers to avoid recursion
                        const elemLoad = await getLoader(dbg, elemVar);
                        if (elemLoad instanceof Point)
                            return new Points(container, elemLoad);
                        else if (elemLoad instanceof Geometry)
                            return new Geometries(container, elemLoad);
                        const valLoad = await getValue(dbg, elemVar);
                        if (valLoad instanceof Value)
                            return new Values(container, valLoad);
                        // Assume it's a container of numbers
                        return new Numbers(container);
                    }
                }
            }
        }
        else if (entry.kind === 'point') {
            if (entry.coordinates?.x && entry.coordinates?.y) {
                const xEval = await evaluateExpression(dbg, variable, entry.coordinates.x);
                const yEval = await evaluateExpression(dbg, variable, entry.coordinates.y);
                if (xEval && yEval) {
                    let su = _getSystemAndUnit(entry);
                    return new Point(xEval, yEval, su[0], su[1]);
                }
            }
        }
        else if (entry.kind === 'segment') {
            if (entry.points?.p0 && entry.points?.p1) {
                const p0Expr = await evaluateExpression(dbg, variable, entry.points.p0);
                const p1Expr = await evaluateExpression(dbg, variable, entry.points.p1);
                if (p0Expr && p1Expr) {
                    return new Segment(p0Expr, p1Expr);
                }
            }
        }
        else if (entry.kind === 'linestring' || entry.kind === 'ring' || entry.kind === 'multipoint') {
            if (entry.points?.container?.name) {
                const contExpr = await evaluateExpression(dbg, variable, entry.points.container.name);
                if (contExpr) {
                    if (entry.kind === 'linestring')
                        return new Linestring(contExpr);
                    else if (entry.kind === 'ring')
                        return new Ring(contExpr);
                    else
                        return new MultiPoint(contExpr);
                }
            }
        }
        else if (entry.kind === 'polygon') {
            if (entry.exteriorring?.name) {
                const extEval = await evaluateExpression(dbg, variable, entry.exteriorring.name);
                if (extEval) {
                    let intEval = undefined;
                    if (entry.interiorrings?.container?.name) {
                        intEval = await evaluateExpression(dbg, variable, entry.interiorrings.container.name);
                    }
                    return new Polygon(extEval, intEval);
                }
            }
        }
        else if (entry.kind === 'multilinestring') {
            if (entry.linestrings?.container?.name) {
                const contExpr = await evaluateExpression(dbg, variable, entry.linestrings.container.name);
                if (contExpr) {
                    const contVar = contExpr.variable;
                    // TODO: only search for Container of Linestrings
                    return await getLoader(dbg, contVar);
                }
            }
        }
        else if (entry.kind === 'multipolygon') {
            if (entry.polygons?.container?.name) {
                const contExpr = await evaluateExpression(dbg, variable, entry.polygons.container.name);
                if (contExpr) {
                    const contVar = contExpr.variable;
                    // TODO: only search for Container of Polygons
                    return await getLoader(dbg, contVar);
                }
            }
        }
        else if (entry.kind === 'geometrycollection') {
            if (entry.geometries?.container?.name) {
                const contExpr = await evaluateExpression(dbg, variable, entry.geometries.container.name);
                if (contExpr) {
                    const contVar = contExpr.variable;
                    const contLoad = await getContainer(dbg, contExpr.variable);
                    if (contLoad)
                        return new GeometryCollection(contLoad);
                }
            }
        }
    }
    return undefined;
}

// Return Container for Variable based on JSON definitions
async function getContainer(dbg: debug.Debugger, variable: Variable): Promise<Container | undefined> {
    const lang: debug.Language | undefined = dbg.language();
    if (lang === undefined)
        return undefined;

    for (const entry of types.match(variable.type, lang, ['container'])) {
        const container = await _getContainer(dbg, variable, entry);
        if (container)
            return container;
    }

    return undefined;
}

// Return Value for Variable based on JSON definitions
async function getValue(dbg: debug.Debugger, variable: Variable): Promise<Value | undefined> {
    const lang: debug.Language | undefined = dbg.language();
    if (lang === undefined)
        return undefined;

    for (const entry of types.match(variable.type, lang, ['value'])) {
        const value = await _getValue(dbg, variable, entry);
        if (value)
            return value;
    }

    return undefined;
}

async function _getContainer(dbg: debug.Debugger, variable: Variable, entry: any): Promise<Container | undefined> {
    if (entry.array && entry.array.start && entry.array.size) {
        const start = await evaluateExpression(dbg, variable, entry.array.start);
        const size = await evaluateExpression(dbg, variable, entry.array.size);
        if (start && size) {
            return new Array(start.expression, size.expression);
        }
    } else if (entry.darray && entry.darray.start && entry.darray.finish) {
        const start = await evaluateExpression(dbg, variable, entry.darray.start);
        const finish = await evaluateExpression(dbg, variable, entry.darray.finish);
        if (start && finish) {
            return new DArray(start.expression, finish.expression);
        }
    } else if (entry.linkedlist && entry.linkedlist.size && entry.linkedlist.value) {
        if (entry.linkedlist.head && entry.linkedlist.next) {
            const size = await evaluateExpression(dbg, variable, entry.linkedlist.size);
            const head = await evaluateExpression(dbg, variable, entry.linkedlist.head);
            if (size && head) {
                const headName = '(' + head.expression.toString(variable) + ')';
                // TEMP: The original type is used by expression to get Tparams, not the head's type
                //       Variable should be renamed or replaced with something in expression.toString()
                const headVar = new Variable(headName, variable.type);
                const next = await evaluateExpression(dbg, headVar, entry.linkedlist.next);
                const value = await evaluateExpression(dbg, headVar, entry.linkedlist.value);
                if (next && value)
                    return new LinkedList(size.expression, head.expression, next.expression, value.expression);
            }
        } // TODO: non-pointer versions - head && next
    }
    return undefined;
}

async function _getValue(dbg: debug.Debugger, variable: Variable, entry: any): Promise<Value | undefined> {
    if (entry.name) {
        const name = await evaluateExpression(dbg, variable, entry.name);
        if (name) {
            return new Value(name.expression);
        }
    }
}

function _getSystemAndUnit(entry: any): [draw.System, Unit] {
    let system = draw.System.None;
    let unit = Unit.None;
    if (entry?.system === 'cartesian') {
        system = draw.System.Cartesian;
    }
    else if (entry?.system === 'geographic') {
        system = draw.System.Geographic;
        unit = Unit.Degree;
        if (entry?.unit === 'radian')
            unit = Unit.Radian;
    }
    else if (entry?.system === 'complex') {
        system = draw.System.Complex;
    }
    return [system, unit];
}
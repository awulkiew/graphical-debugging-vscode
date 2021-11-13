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


interface ExpressionPart {
    toString(variable: Variable): string;
}
class ExpressionString implements ExpressionPart {
    constructor(private _str: string) {}
    toString(variable: Variable): string { return this._str; }
}
class ExpressionThis implements ExpressionPart {
    toString(variable: Variable): string { return '(' + variable.name + ')'; }
}
class ExpressionNParam implements ExpressionPart {
    constructor(protected _i: number) {}
    toString(variable: Variable): string { return variable.nparam(this._i); }
}
class ExpressionTParam extends ExpressionNParam {
    toString(variable: Variable): string { return variable.tparam(this._i); }
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
        return result;
    }

    private _parts : ExpressionPart[] = [];
}


class EvaluatedExpression {
    constructor(
        public expression: Expression,
        public name: string,
        public evaluated: any
    ) {}

    get type(): string { return this.evaluated.type; }
    get variable(): Variable { return new Variable(this.name, this.evaluated.type); }
}

async function evaluateExpression(dbg: debug.Debugger, variable: Variable, expression: string): Promise<EvaluatedExpression | undefined> {
	const expr = new Expression(expression);
	const str = expr.toString(variable);
	const e = await dbg.evaluate(str);
    return e !== undefined && e.type !== undefined ? new EvaluatedExpression(expr, str, e) : undefined;
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
        const sizeExpr = await dbg.evaluate(sizeStr);
        if (sizeExpr === undefined || sizeExpr.type === undefined)
            return 0;
        return parseInt(sizeExpr.result);
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
        const sizeExpr = await dbg.evaluate(sizeStr);
        if (sizeExpr === undefined || sizeExpr.type === undefined)
            return 0;
        return parseInt(sizeExpr.result);
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

// Value

export class Value {
    constructor(private _name: Expression) {
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<number | undefined> {
        const valStr = this._name.toString(variable);
        const valEval = await dbg.evaluate(valStr);
        if (valEval === undefined || valEval.type === undefined)
            return undefined;
        return parseFloat(valEval.result);
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
            const elEval = await dbg.evaluate(elStr);
            if (elEval === undefined || elEval.type === undefined)
                return undefined;
            const el = parseFloat(elEval.result);
            ys.push(el);
        }
        return new draw.Plot(undefined, ys);
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
        const elEval = await dbg.evaluate(elStr);
        if (elEval === undefined || elEval.type === undefined)
            return undefined;
        let ys: number[] = [];
        let v = new Variable(elStr, elEval.type);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const n = await this._value.load(dbg, v);
            if (n === undefined)
                return undefined
            ys.push(n);
        }
        return new draw.Plot(undefined, ys);
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
        const elEval = await dbg.evaluate(elStr);
        if (elEval === undefined || elEval.type === undefined)
            return undefined;
        let xs: number[] = [];
        let ys: number[] = [];
        let v = new Variable(elStr, elEval.type);
        for await (let elStr of this._container.elements(dbg, variable)) {
            v.name = elStr;
            const point = await this._point.load(dbg, v);
            if (point === undefined)
                return undefined;
            const p = point as draw.Point;
            xs.push(p.x)
            ys.push(p.y);
        }
        return new draw.Plot(xs, ys);
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
        const elEval = await dbg.evaluate(elStr);
        if (elEval === undefined || elEval.type === undefined)
            return undefined;
        let drawables: draw.Drawable[] = [];
        let v = new Variable(elStr, elEval.type);
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
        private _yEval: EvaluatedExpression) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const xStr = this._xEval.expression.toString(variable);
        const xe = await dbg.evaluate(xStr);
        if (xe === undefined || xe.type === undefined)
            return undefined
        const yStr = this._yEval.expression.toString(variable);
        const ye = await dbg.evaluate(yStr);
        if (ye === undefined || ye.type === undefined)
            return undefined
        const x = parseFloat(xe.result);
        const y = parseFloat(ye.result);
        return new draw.Point(x, y);
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
            return new draw.Ring(plot.xs, plot.ys);
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

function parseFiles(directoryPath: string) {
    let result = [];
    let fileNames: string[] = [];
    try {
        fileNames = fs.readdirSync(directoryPath);
    } catch(err) {}
    for (const fileName of fileNames) {
        if (fileName.endsWith('.json')) {
            const p = path.join(directoryPath, fileName);
            const f = fs.readFileSync(p, 'utf-8');
            const o = JSON.parse(f);
            if (o.name === 'graphicaldebugging') {
                result.push(o);
            }
        }
    }
    return result;
}

function stringToLanguage(name: string | undefined): debug.Language | undefined {
    switch(name){
        case 'cpp': return debug.Language.Cpp;
        case 'java': return debug.Language.Java;
        case 'javascript': return debug.Language.JavaScript;
        case 'python': return debug.Language.Python;
        default: return undefined;
    }
}

function parseLanguages(directory: string): Map<debug.Language, any[]> {
    let languages = new Map<debug.Language, any[]>();
    const defs = parseFiles(directory);
    for (const def of defs) {
        const lang = stringToLanguage(def.language);
        if (lang === undefined)
            continue;
        if (! languages.has(lang))
            languages.set(lang, []);
        let val = languages.get(lang);
        if (val && def.types) {
            for (const t of def.types)
                val.push(t);
        }
    }
    return languages;
}

let languages = new Map<debug.Language, any[]>();
let languagesUD = new Map<debug.Language, any[]>();

export function updateLoaders(dbg: debug.Debugger) {
    // TODO: update only if needed, check modification time, esspecially for user-defined types
    languages = new Map<debug.Language, any[]>();
    languagesUD = new Map<debug.Language, any[]>();

    {
        const p = path.join(__filename, '..', '..', 'resources');
        languages = parseLanguages(p);
    }

    {
        let dir = vscode.workspace.getConfiguration().get<string>('graphicalDebugging.additionalTypesDirectory');
        let p: string | undefined = undefined;
        if (dir?.startsWith('.')) {
            const workspaceDir = dbg.workspaceFolder();
            if (workspaceDir)
                p = path.join(workspaceDir, dir);
        }
        else
            p = dir;
        if (p)
            languagesUD = parseLanguages(p);
    }
}

// Return Container or Loader for Variable based on JSON definitions
export async function getLoader(dbg: debug.Debugger, variable: Variable): Promise<Container | Value | Loader | undefined> {
    const lang: debug.Language | undefined = dbg.language();
    if (lang === undefined)
        return undefined;

    const types: (any[] | undefined)[] = [languages.get(lang), languagesUD.get(lang)];
    
    for (const ts of types) {
        if (ts) {
            for (const entry of ts) {
                if (variable.type.match('^' + entry.type + '$')) {
                    if (entry.kind === 'container') {
                        const container: Container | undefined = await getContainer(dbg, variable, entry);
                        // TODO: Return raw container if it is desired.
                        //       Additional parameter is needed for this.
                        if (container) {
                            const loader: ContainerLoader | undefined = await getContainerLoader(dbg, variable, container);
                            if (loader)
                                return loader;
                        }
                    }
                    else if (entry.kind === 'value') {
                        if (entry.name) {
                            const name = await evaluateExpression(dbg, variable, entry.name);
                            if (name) {
                                return new Value(name.expression);
                            }
                        }
                    }
                    else if (entry.kind === 'point') {
                        if (entry.coordinates && entry.coordinates.x && entry.coordinates.y) {
                            const xEval = await evaluateExpression(dbg, variable, entry.coordinates.x);
                            const yEval = await evaluateExpression(dbg, variable, entry.coordinates.y);
                            if (xEval && yEval) {
                                return new Point(xEval, yEval);
                            }
                        }
                    }
                    else if (entry.kind === 'linestring' || entry.kind === 'ring' || entry.kind === 'multipoint') {
                        if (entry.points && entry.points.container && entry.points.container.name) {
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
                        if (entry.exteriorring && entry.exteriorring.name) {
                            const extEval = await evaluateExpression(dbg, variable, entry.exteriorring.name);
                            if (extEval) {
                                let intEval = undefined;
                                if (entry.interiorrings && entry.interiorrings.container && entry.interiorrings.container.name) {
                                    intEval = await evaluateExpression(dbg, variable, entry.interiorrings.container.name);
                                }
                                return new Polygon(extEval, intEval);
                            }
                        }
                    }
                    else if (entry.kind === 'multilinestring') {
                        if (entry.linestrings && entry.linestrings.container && entry.linestrings.container.name) {
                            const contExpr = await evaluateExpression(dbg, variable, entry.linestrings.container.name);
                            if (contExpr) {
                                const contVar = contExpr.variable;
                                // TODO: only search for Container of Linestrings
                                return await getLoader(dbg, contVar);
                            }
                        }
                    }
                    else if (entry.kind === 'multipolygon') {
                        if (entry.polygons && entry.polygons.container && entry.polygons.container.name) {
                            const contExpr = await evaluateExpression(dbg, variable, entry.polygons.container.name);
                            if (contExpr) {
                                const contVar = contExpr.variable;
                                // TODO: only search for Container of Polygons
                                return await getLoader(dbg, contVar);
                            }
                        }
                    }
                }
            }
        }
    }
    return undefined;
}

// Return Container for Variable based on JSON definition
async function getContainer(dbg: debug.Debugger, variable: Variable, entry: any): Promise<Container | undefined> {
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
    }
    return undefined;
}

// Return ContainerLoader for Variable
async function getContainerLoader(dbg: debug.Debugger, variable: Variable, container: Container): Promise<ContainerLoader | undefined> {
    const elemStr = container.element(variable);
    if (elemStr) {
        const e = await dbg.evaluate(elemStr);
        if (e && e.type) {
            const elemVar = new Variable(elemStr, e.type);
            // TODO: only search for non-containers to avoid recursion
            const elemLoad = await getLoader(dbg, elemVar);
            if (elemLoad instanceof Point) {
                return new Points(container, elemLoad);
            } else if (elemLoad instanceof Geometry) {
                return new Geometries(container, elemLoad);
            } else if (elemLoad instanceof Value) {
                return new Values(container, elemLoad);
            } else {
                return new Numbers(container);
            }
        }
    }
}
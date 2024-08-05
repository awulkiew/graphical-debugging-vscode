import * as debug from './debugger';
import * as draw from './drawable'
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import * as util from './util'

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
            result.push(type.substring(param_first, param_last));
            param_first = -1;
            param_last = -1;
        }

        ++index;
    }
    return result;
}

function addSpacesInTemplates(str: string): string {
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
    toString(variable: Variable, parameter: number | undefined): string;
}
class ExpressionString implements IExpressionPart {
    constructor(private _str: string) {}
    toString(variable: Variable, parameter: number | undefined): string { return this._str; }
}
class ExpressionThis implements IExpressionPart {
    toString(variable: Variable, parameter: number | undefined): string { return '(' + variable.name + ')'; }
}
class ExpressionNParam implements IExpressionPart {
    constructor(protected _i: number) {}
    toString(variable: Variable, parameter: number | undefined): string { return variable.nparam(this._i); }
}
class ExpressionTParam extends ExpressionNParam {
    toString(variable: Variable, parameter: number | undefined): string { return variable.tparam(this._i); }
}
class ExpressionType implements IExpressionPart {
    toString(variable: Variable, parameter: number | undefined): string { return variable.type; }
}
class ExpressionIndex implements IExpressionPart {
    toString(variable: Variable, parameter: number | undefined): string { return parameter !== undefined ? parameter.toString() : "0"; }
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
                else if (match[0] === '$i') {
                    this._parts.push(new ExpressionIndex());
                    index = match.index + 2;
                }
            }
        }
        if (index < expression.length) {
            this._parts.push(new ExpressionString(expression.substr(index)));
        }
    }

    toString(variable: Variable, parameter: number | undefined = undefined): string {
        let result: string = '';
        for (let part of this._parts) {
            result += part.toString(variable, parameter);            
        }
        // TODO: do this only for C++ ?
        // It is possible that this should depend on the debugger
        return addSpacesInTemplates(result);
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

async function evaluateExpression(dbg: debug.Debugger, variable: Variable, expressionName: string, expressionType: string | undefined = undefined): Promise<EvaluatedExpression | undefined> {
	const expr = new Expression(expressionName);
    const str = expr.toString(variable);
    // Technically if expressionType is passed we don't have to evaluate the expression because
    // the type is known. But right now this function is used to check if a type contains members
    // defined in json file. So get the value anyway and after that alter the type.
    let vt = await dbg.getValueAndRawType(str);
    if (vt === undefined)
        return undefined;
    if (expressionType !== undefined) {
        const typeExpr = new Expression(expressionType);
        const type = typeExpr.toString(variable);
        if (type !== undefined && type !== '')
            vt[1] = type;
    }
    return new EvaluatedExpression(expr, str, vt[1]);
}

async function evaluateIndexedExpression(dbg: debug.Debugger, variable: Variable, expressionName: string, parameter: number): Promise<EvaluatedExpression | undefined> {
	const expr = new Expression(expressionName);
    const str = expr.toString(variable, parameter);
    let vt = await dbg.getValueAndRawType(str);
    if (vt === undefined)
        return undefined;
    return new EvaluatedExpression(expr, str, vt[1]);
}

function getValueFromExpressionStr(dbg: debug.Debugger, str: string): number | boolean | undefined {
    const language = dbg.language();
    if (language != undefined) {
        if (language === debug.Language.Cpp || language === debug.Language.JavaScript || language === debug.Language.Java) {
            if (str === 'true')
                return true;
            else if (str === 'false')
                return false;
        }
        else if (language === debug.Language.Python) {
            if (str === 'True')
                return true;
            else if (str === 'False')
                return false;
        }
    }
    const n = parseFloat(str);
    return isNaN(n) ? undefined : n;
}

async function getValueOrEvaluateExpression(dbg: debug.Debugger, variable: Variable, expression: string): Promise<EvaluatedExpression | number | boolean | undefined> {
	const expr = new Expression(expression);
	const str = expr.toString(variable);
    const val = getValueFromExpressionStr(dbg, str);
    if (val !== undefined)
        return val;
	const vt = await dbg.getValueAndRawType(str);
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

// Static array
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

// Dynamic array
export class DArray extends ContiguousContainer {
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

// Indexable/subscriptable array
export class IArray extends RandomAccessContainer
{
    constructor(private _element: Expression, private _size: Expression) {
        super();
    }

    element(variable: Variable): string | undefined {
        return this._element.toString(variable, 0);
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
            const elStr = this._element.toString(variable, i);
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
    constructor(private _container: Container, private _numberType: string) {
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
        return new draw.Plot(util.indexesArray(ys), ys, draw.System.None);
    }
}

export class Values extends ContainerLoader {
    constructor(private _container: Container, private _value: Value, private _valueType: string) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let ys: number[] = [];
        for await (let elStr of this._container.elements(dbg, variable)) {
            const v = new Variable(elStr, this._valueType);
            const n = await this._value.load(dbg, v);
            if (n === undefined)
                return undefined
            ys.push(n);
        }
        return new draw.Plot(util.indexesArray(ys), ys, draw.System.None);
    }
}

export class Points extends ContainerLoader {
    constructor(private _container: Container, private _point: Point, private _pointType: string) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let xs: number[] = [];
        let ys: number[] = [];
        let system = draw.System.None;
        for await (let elStr of this._container.elements(dbg, variable)) {
            let v = new Variable(elStr, this._pointType);
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
    constructor(private _container: Container, private _geometry: Geometry, private _geometryType: string) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let drawables: draw.Drawable[] = [];
        for await (let elStr of this._container.elements(dbg, variable)) {
            const v = new Variable(elStr, this._geometryType);
            const d = await this._geometry.load(dbg, v);
            if (d === undefined)
                return undefined;
            drawables.push(d);
        }
        return new draw.Drawables(drawables);
    }
}

export class DynamicGeometries extends ContainerLoader {
    constructor(private _container: Container) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        let drawables: draw.Drawable[] = [];
        for await (let elStr of this._container.elements(dbg, variable)) {
            const elType = await dbg.getRawType(elStr);
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
    constructor(private _containerExpr: EvaluatedExpression,
                private _pointsLoad: Points) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        return this._pointsLoad.load(dbg, contVar);
    }
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
        this._p0Load = await getPointLoaderIfUndefined(this._p0Load, dbg, p0Var);
        this._p1Load = await getPointLoaderIfUndefined(this._p1Load, dbg, p1Var);
        const p0 = await this._p0Load?.load(dbg, p0Var) as draw.Point;
        const p1 = await this._p1Load?.load(dbg, p1Var) as draw.Point;
        if (p0 == undefined || p1 === undefined)
            return undefined;
        return new draw.Plot([p0.x, p1.x], [p0.y, p1.y], p0.system);
    }
    private _p0Load: Point | undefined = undefined;
    private _p1Load: Point | undefined = undefined;
}

async function getPointLoaderIfUndefined(loader: Point | undefined, dbg: debug.Debugger, variable: Variable): Promise<Point | undefined>  {
    if (loader === undefined) {
        // TODO: only search for Points
        const load = await getLoader(dbg, variable);
        if (load instanceof Point)
            loader = load as Point;
    }
    return loader;
}

export class Box extends Geometry {
    constructor(private _minExpr: EvaluatedExpression,
                private _maxExpr: EvaluatedExpression) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const minStr = this._minExpr.expression.toString(variable);
        const minVar = new Variable(minStr, this._minExpr.type);
        const maxStr = this._maxExpr.expression.toString(variable);
        const maxVar = new Variable(maxStr, this._maxExpr.type);
        this._minLoad = await getPointLoaderIfUndefined(this._minLoad, dbg, minVar);
        this._maxLoad = await getPointLoaderIfUndefined(this._maxLoad, dbg, maxVar);
        const min = await this._minLoad?.load(dbg, minVar) as draw.Point;
        const max = await this._maxLoad?.load(dbg, maxVar) as draw.Point;
        if (min == undefined || max === undefined)
            return undefined;        
        return loadBox(min.x, min.y, max.x, max.y, min.system);
    }
    private _minLoad: Point | undefined = undefined;
    private _maxLoad: Point | undefined = undefined;
}

export class Box2 extends Geometry {
    constructor(
        private _minxEval: EvaluatedExpression,
        private _minyEval: EvaluatedExpression,
        private _maxxEval: EvaluatedExpression,
        private _maxyEval: EvaluatedExpression,
        private _system: draw.System,
        private _unit: Unit) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const minxStr = this._minxEval.expression.toString(variable);
        const minxVal = await dbg.getValue(minxStr);
        if (minxVal === undefined)
            return undefined;
        const minyStr = this._minyEval.expression.toString(variable);
        const minyVal = await dbg.getValue(minyStr);
        if (minyVal === undefined)
            return undefined;
        const maxxStr = this._maxxEval.expression.toString(variable);
        const maxxVal = await dbg.getValue(maxxStr);
        if (maxxVal === undefined)
            return undefined;
        const maxyStr = this._maxyEval.expression.toString(variable);
        const maxyVal = await dbg.getValue(maxyStr);
        if (maxyVal === undefined)
            return undefined;
        let minx = parseFloat(minxVal);
        let miny = parseFloat(minyVal);
        let maxx = parseFloat(maxxVal);
        let maxy = parseFloat(maxyVal);
        // Convert radians to degrees if needed
        if (this._unit === Unit.Radian) {
            const r2d = 180 / Math.PI;
            minx *= r2d;
            miny *= r2d;
            maxx *= r2d;
            maxy *= r2d;
        }
        return loadBox(minx, miny, maxx, maxy, this._system);
    }
}

// TODO: This way the longitude interval has to be calcualted from Ring points
// TODO: This logic should rather be implemented in draw
function loadBox(minx: number, miny: number, maxx: number, maxy: number, system: draw.System): draw.Ring {
    if (system !== draw.System.Geographic) {
        return new draw.Ring([minx, minx, maxx, maxx], [miny, maxy, maxy, miny], false, system, true);
    }
    else {
        miny = util.bounded(miny, -90, 90);
        maxy = util.bounded(maxy, -90, 90);
        if (maxx < minx)
            maxx = minx + util.uLon(maxx - minx);
        if (maxx - minx > 360)
            maxx = minx + 360;
        let xs: number[] = [minx];
        let ys: number[] = [miny];
        const fstep = maxy == -90 || maxy == 90 ? 361 : 2.5;
        for (let x = minx; x < maxx; x += fstep) {
            xs.push(x); ys.push(maxy);
        }
        xs.push(maxx); ys.push(maxy);
        const bstep = miny == -90 || miny == 90 ? 361 : 2.5;
        for (let x = maxx; x > minx; x -= bstep) {
            xs.push(x); ys.push(miny);
        }
        xs.push(minx); ys.push(miny);
        return new draw.Ring(xs, ys, false, system, true);
    }
}

export class Linestring extends PointsRange {
    constructor(containerExpr: EvaluatedExpression,
                pointsLoad: Points) {
        super(containerExpr, pointsLoad);
    }
}

export class Ring extends PointsRange {
    constructor(containerExpr: EvaluatedExpression,
                pointsLoad: Points,
                private _orientation: EvaluatedExpression | number | boolean | undefined = undefined,
                private _cw: boolean = true) {
        super(containerExpr, pointsLoad);
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const plot = await super.load(dbg, variable);
        if (plot instanceof draw.Plot && plot.xs) {
            // TODO: This doesn't work well with classes like Shapely Polygon
            //       where is_ccw member indicates the actual order of internal rings.
            //       Such rings should be reversed based on the exterior ring.
            //       Here rings are reversed locally.
            const isCw = await this._isCw(dbg, variable);
            return new draw.Ring(plot.xs, plot.ys, !isCw, plot.system);
        }
        else
            return undefined;
    }

    async _isCw(dbg: debug.Debugger, variable: Variable): Promise<boolean> {
        if (this._orientation !== undefined) {
            let flag: number | boolean | undefined = undefined;
            if (this._orientation instanceof EvaluatedExpression) {
                const str = (this._orientation as EvaluatedExpression).expression.toString(variable);
                const val = await dbg.getValue(str);
                if (val !== undefined)
                    flag = getValueFromExpressionStr(dbg, val);
            }
            else
                flag = this._orientation;

            if (flag !== undefined) {
                const is_false = flag === 0 || flag === false;
                if (this._cw && is_false || !this._cw && !is_false)
                    return false;
            }
        }
        return true;
    }
}

export class MultiPoint extends PointsRange {
    constructor(containerExpr: EvaluatedExpression,
                pointsLoad: Points) {
        super(containerExpr, pointsLoad);
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
            return new draw.Polygon(extRing);
        const isCw = extRing;
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

export class MultiGeometry extends Geometry {
    constructor(private _containerExpr: EvaluatedExpression,
                private _geometriesLoad: Geometries) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        return this._geometriesLoad.load(dbg, contVar);
    }
}

export class GeometryCollection extends Geometry {
    constructor(private _containerExpr: EvaluatedExpression,
                private _dynamicGeometriesLoad: DynamicGeometries) {
        super();
    }
    async load(dbg: debug.Debugger, variable: Variable): Promise<draw.Drawable | undefined> {
        const contStr = this._containerExpr.expression.toString(variable);
        const contVar = new Variable(contStr, this._containerExpr.type);
        return this._dynamicGeometriesLoad.load(dbg, contVar);
    }
}

class LanguageTypes {
    public kinds: Map<string, any[]> = new Map<string, any[]>();
    public aliases: Map<string, string[]> = new Map<string, string[]>();
}

export class Types {

    *matchWithAliases(type: string, lang: debug.Language, kinds: string[] | undefined = undefined) {
        for (const entry of this.match(type, lang, kinds))
            yield [entry, type];
        for (const alias of this.aliases(type, lang))
            for (const entry of this.match(alias, lang, kinds))
                yield [entry, alias];
    }

    *match(type: string, lang: debug.Language, kinds: string[] | undefined = undefined) {
        for (const entry of this.get(lang, kinds))
            if (type.match('^' + entry.type + '$'))
                yield entry;
    }

    // Technically this function returns original types as defined in the json file, not aliases
    private *aliases(type: string, lang: debug.Language) {
        for (const alias of this._aliases(this._languages, type, lang))
            yield alias;
        for (const alias of this._aliases(this._languagesUD, type, lang))
            yield alias;
    }

    private *get(lang: debug.Language, kinds: string[] | undefined = undefined) {
        for (const type of this._get(this._languages, lang, kinds))
            yield type;
        for (const type of this._get(this._languagesUD, lang, kinds))
            yield type;
    }

    private *_aliases(map: Map<debug.Language, LanguageTypes>, type: string, lang: debug.Language) {
        const lt = map.get(lang);
        if (lt === undefined)
            return;
        const aliases = lt.aliases.get(type);
        if (aliases === undefined)
            return;
        for (const alias of aliases)
            yield alias;
    }

    private *_get(map: Map<debug.Language, LanguageTypes>, language: debug.Language, kinds: string[] | undefined = undefined) {
        const lt = map.get(language);
        if (lt === undefined)
            return;
        if (kinds === undefined) {
            for (const k of lt.kinds) {
                for (const t of k[1]) {
                    yield t;
                }
            }
        } else {
            for (const kind of kinds) {
                const k = lt.kinds.get(kind);
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
                            languages: Map<debug.Language, LanguageTypes>) {
        const files = this._parseFiles(filePaths);
        for (const file of files) {
            const lang = this._stringToLanguage(file.language);
            if (lang === undefined)
                continue;
            if (! languages.has(lang))
                languages.set(lang, new LanguageTypes());
            let language = languages.get(lang);
            if (language === undefined) // silence TS
                continue;
            if (file.types !== undefined) {
                for (const type of file.types) {
                    if (type.kind === undefined)
                        continue;
                    if (! language.kinds.has(type.kind))
                        language.kinds.set(type.kind, []);
                    let types = language.kinds.get(type.kind);
                    if (types === undefined) // silence TS
                        continue;
                    types.push(type);
                }
            }
            if (file.aliases !== undefined) {
                for (const alias of file.aliases) {
                    if (alias.name === undefined)
                        continue;
                    if (! language.aliases.has(alias.name))
                        language.aliases.set(alias.name, []);
                    let aliases = language.aliases.get(alias.name);
                    if (aliases === undefined) // silence TS
                        continue;
                    const typeWithSpaces = addSpacesInTemplates(alias.type);
                    aliases.push(typeWithSpaces);
                }
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
            case 'csharp': return debug.Language.CSharp;
            case 'java': return debug.Language.Java;
            case 'javascript': return debug.Language.JavaScript;
            case 'python': return debug.Language.Python;
            case 'ruby': return debug.Language.Ruby;
            default: return undefined;
        }
    }

    private _languages: Map<debug.Language, LanguageTypes> = new Map<debug.Language, LanguageTypes>();
    private _languagesUD: Map<debug.Language, LanguageTypes> = new Map<debug.Language, LanguageTypes>();
    private _files: Map<string, number> = new Map<string, number>();
    private _filesUD: Map<string, number> = new Map<string, number>();
}

export let types: Types = new Types();

async function *matchWithAliases(dbg: debug.Debugger, type: string, kinds: string[] | undefined = undefined) {
    const lang: debug.Language | undefined = dbg.language();
    if (lang === undefined)
        return;
    for (const [entry, typ] of types.matchWithAliases(type, lang, kinds)) {
        yield [entry, typ];
    }
    const unrolledType = await dbg.unrollTypeAlias(type)
    // console.log(unrolledType);
    if (unrolledType !== type) {
        for (const entry of types.match(unrolledType, lang, kinds)) {
            yield [entry, unrolledType];
        }
    }
}

// const nonContainers = ['value', 'point', 'linestring', 'ring', 'multipoint', 'polygon', 'multilinestring', 'multilipolygon'];
// const geometries = ['point', 'linestring', 'ring', 'multipoint', 'polygon', 'multilinestring', 'multilipolygon'];

type KindPredicate = (kind: string) => boolean;
function allKinds(kind: string) { return true; }
function nonContainers(kind: string) { return kind !== 'container'; }
function onlyContainers(kind: string) { return kind === 'container'; }
function onlyPoints(kind: string) { return kind === 'point'; }
function onlyLinestrings(kind: string) { return kind === 'linestring'; }
function onlyPolygons(kind: string) { return kind === 'polygon'; }

// Return Container or Loader for Variable based on JSON definitions
export async function getLoader(dbg: debug.Debugger,
                                variable: Variable,
                                kindPred: KindPredicate = allKinds,
                                elemKindPred: KindPredicate = nonContainers): Promise<Loader | undefined> {
    
    for await (const [entry, type] of matchWithAliases(dbg, variable.type)) {
        if (! kindPred(entry.kind)) {
            continue;
        }
        variable.type = type; // If alias is matched then the type has to be changed
        if (entry.kind === 'container') {
            const container: Container | undefined = await _getContainer(dbg, variable, entry);
            if (container !== undefined) {
                const elements = await getElements(dbg, variable, container, elemKindPred);
                if (elements !== undefined)
                    return elements;
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
        else if (entry.kind === 'box') {
            if (entry.points !== undefined) {
                if (entry.points.min && entry.points.max) {
                    const minExpr = await evaluateExpression(dbg, variable, entry.points.min);
                    const maxExpr = await evaluateExpression(dbg, variable, entry.points.max);
                    if (minExpr && maxExpr) {
                        return new Box(minExpr, maxExpr);
                    }
                }
            }
            else if (entry.coordinates !== undefined) {
                if (entry.coordinates.minx && entry.coordinates.miny && entry.coordinates.maxx && entry.coordinates.maxy) {
                    const minxEval = await evaluateExpression(dbg, variable, entry.coordinates.minx);
                    const minyEval = await evaluateExpression(dbg, variable, entry.coordinates.miny);
                    const maxxEval = await evaluateExpression(dbg, variable, entry.coordinates.maxx);
                    const maxyEval = await evaluateExpression(dbg, variable, entry.coordinates.maxy);
                    if (minxEval && minyEval && maxxEval && maxyEval) {
                        let su = _getSystemAndUnit(entry);
                        return new Box2(minxEval, minyEval, maxxEval, maxyEval, su[0], su[1]);
                    }
                }
            }
        }
        else if (entry.kind === 'linestring' || entry.kind === 'ring' || entry.kind === 'multipoint') {
            if (entry.points?.container !== undefined) {
                let contExpr: EvaluatedExpression | undefined = undefined;
                let pointsLoad: Loader | undefined = undefined;
                if (entry.points.container.name !== undefined) {
                    contExpr = await evaluateExpression(dbg, variable, entry.points.container.name, entry.points.container.type);
                    if (contExpr) {
                        const contStr = contExpr.expression.toString(variable);
                        const contVar = new Variable(contStr, contExpr.type);
                        pointsLoad = await getLoader(dbg, contVar, onlyContainers, onlyPoints);
                    }
                }
                else {
                    contExpr = new EvaluatedExpression(new Expression('$this'), variable.name, variable.type);
                    const contLoad: Container | undefined = await _getContainer(dbg, variable, entry.points.container);
                    if (contLoad !== undefined) {
                        pointsLoad = await getElements(dbg, variable, contLoad, onlyPoints);
                    }
                }
                if (contExpr && pointsLoad instanceof Points) {
                    if (entry.kind === 'linestring')
                        return new Linestring(contExpr, pointsLoad);
                    else if (entry.kind === 'ring') {
                        let orientation = undefined;
                        let cw = true;
                        if (entry.cw !== undefined) {
                            orientation = await getValueOrEvaluateExpression(dbg, variable, entry.cw);
                            cw = true;
                        }
                        else if (entry.ccw !== undefined) {
                            orientation = await getValueOrEvaluateExpression(dbg, variable, entry.ccw);
                            cw = false;
                        }
                        return new Ring(contExpr, pointsLoad, orientation, cw);
                    }
                    else
                        return new MultiPoint(contExpr, pointsLoad);
                }
            }
        }
        else if (entry.kind === 'polygon') {
            if (entry.exteriorring?.name) {
                const extEval = await evaluateExpression(dbg, variable, entry.exteriorring.name, entry.exteriorring.type);
                if (extEval) {
                    let intEval = undefined;
                    if (entry.interiorrings?.container?.name) {
                        intEval = await evaluateExpression(dbg, variable, entry.interiorrings.container.name, entry.interiorrings.container.type);
                    }
                    return new Polygon(extEval, intEval);
                }
            }
        }
        else if (entry.kind === 'multilinestring') {
            if (entry.linestrings?.container !== undefined) {
                if (entry.linestrings.container.name != undefined) {
                    const contExpr = await evaluateExpression(dbg, variable, entry.linestrings.container.name, entry.linestrings.container.type);
                    if (contExpr) {
                        const contVar = contExpr.variable;
                        const geometriesLoad = await getLoader(dbg, contVar, onlyContainers, onlyLinestrings) as Geometries;
                        if (geometriesLoad != undefined)
                            return new MultiGeometry(contExpr, geometriesLoad);
                    }
                }
                else {
                    const contLoad: Container | undefined = await _getContainer(dbg, variable, entry.linestrings.container);
                    if (contLoad !== undefined)
                        return await getElements(dbg, variable, contLoad, onlyLinestrings);
                }
            }
        }
        else if (entry.kind === 'multipolygon') {
            if (entry.polygons?.container !== undefined) {
                if (entry.polygons.container.name !== undefined) {
                    const contExpr = await evaluateExpression(dbg, variable, entry.polygons.container.name, entry.polygons.container.type);
                    if (contExpr) {
                        const contVar = contExpr.variable;
                        const geometriesLoad = await getLoader(dbg, contVar, onlyContainers, onlyPolygons) as Geometries;
                        if (geometriesLoad != undefined)
                            return new MultiGeometry(contExpr, geometriesLoad);
                    }
                }
                else {
                    const contLoad: Container | undefined = await _getContainer(dbg, variable, entry.polygons.container);
                    if (contLoad !== undefined)
                        return await getElements(dbg, variable, contLoad, onlyPolygons);
                }
            }
        }
        else if (entry.kind === 'geometrycollection') {
            if (entry.geometries?.container !== undefined) {
                if (entry.geometries.container.name !== undefined) {
                    const contExpr = await evaluateExpression(dbg, variable, entry.geometries.container.name, entry.geometries.container.type);
                    if (contExpr) {
                        const contVar = contExpr.variable;
                        const contLoad = await getContainer(dbg, contExpr.variable);
                        if (contLoad !== undefined)
                            return new GeometryCollection(contExpr, new DynamicGeometries(contLoad));
                    }
                }
                else {
                    const contLoad: Container | undefined = await _getContainer(dbg, variable, entry.geometries.container);
                    if (contLoad !== undefined)
                        return new DynamicGeometries(contLoad);
                }
            }
        }
    }
    return undefined;
}

// Return Container for Variable based on JSON definitions
async function getContainer(dbg: debug.Debugger, variable: Variable): Promise<Container | undefined> {
    for await (const [entry, type] of matchWithAliases(dbg, variable.type, ['container'])) {
        variable.type = type;
        const container = await _getContainer(dbg, variable, entry);
        if (container)
            return container;
    }

    return undefined;
}

// Return Value for Variable based on JSON definitions
async function getValue(dbg: debug.Debugger, variable: Variable): Promise<Value | undefined> {
    for await(const [entry, type] of matchWithAliases(dbg, variable.type, ['value'])) {
        variable.type = type;
        const value = await _getValue(dbg, variable, entry);
        if (value)
            return value;
    }

    return undefined;
}

async function getElements(dbg: debug.Debugger,
                           variable: Variable,
                           container: Container,
                           elemKindPred: KindPredicate): Promise<Loader | undefined> {
    const elemStr = container.element(variable);
    if (elemStr !== undefined) {
        const elemType = await dbg.getRawType(elemStr);
        if (elemType !== undefined) {
            const elemVar = new Variable(elemStr, elemType);
            const elemLoad = await getLoader(dbg, elemVar, elemKindPred);
            if (elemLoad instanceof Point)
                return new Points(container, elemLoad, elemType);
            else if (elemLoad instanceof Geometry)
                return new Geometries(container, elemLoad, elemType);
            if (elemKindPred('value')) {
                const valLoad = await getValue(dbg, elemVar);
                if (valLoad instanceof Value)
                    return new Values(container, valLoad, elemType);
                // Assume it's a container of numbers
                return new Numbers(container, elemType);
            }
        }
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
    } else if (entry.iarray && entry.iarray.element && entry.iarray.size) {
        const element = await evaluateIndexedExpression(dbg, variable, entry.iarray.element, 0);
        const size = await evaluateExpression(dbg, variable, entry.iarray.size);
        if (element && size) {
            return new IArray(element.expression, size.expression);
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
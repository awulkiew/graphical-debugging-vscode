# Graphical Debugging
### Extension for Visual Studio Code

[![VS Marketplace](https://vsmarketplacebadges.dev/version-short/AdamWulkiewicz.graphicaldebugging-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=AdamWulkiewicz.graphicaldebugging-vscode)
[![Installs](https://vsmarketplacebadges.dev/installs-short/AdamWulkiewicz.graphicaldebugging-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=AdamWulkiewicz.graphicaldebugging-vscode)
[![Rating](https://vsmarketplacebadges.dev/rating-short/AdamWulkiewicz.graphicaldebugging-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=AdamWulkiewicz.graphicaldebugging-vscode)
![License](https://img.shields.io/github/license/awulkiew/graphical-debugging-vscode.svg)
[![Donate](https://img.shields.io/badge/Donate-_-yellow.svg)](https://awulkiew.github.io/donate)

This extension allows to display graphical representation of variables during debugging.

![Graphical Debugging](resources/extension.png)

#### Download

You can download this extension from [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AdamWulkiewicz.graphicaldebugging-vscode) or [GitHub](https://github.com/awulkiew/graphical-debugging-vscode/releases).

#### Instructions

1. Place a breakpoint
2. Start debugging
3. After clicking + in Graphical Watch write the name of a variable

#### Supported types

##### C/C++ (cppdbg, cppvsdbg, lldb, cortex-debug)

* Containers of values, points and other geometries
  * C-style array
  * STL: `array`, `deque`, `list`, `span`, `vector`
  * Boost.Array: `array`
  * Boost.Container: `static_vector`, `vector`
  * Boost.Geometry: `varray`
* 1D values
  * STL: `duration`
  * Boost.Chrono: `duration`   
  * Boost.Units: `quantity`   
* 2D values/geometries
  * STL: `complex`, `pair`
  * Boost.Geometry: `box`, `linestring`, `multi_linestring`, `multi_point`, `multi_polygon`, `point`, `point_xy`, `point_xyz`, `polygon`, `ring`, `segment`
  * Boost.Polygon: `point_data`, `polygon_data`, `polygon_with_holes_data`, `rectangle_data`, `segment_data`

##### Javascript (chrome, msedge, node, pwa-node, pwa-chrome, pwa-msedge)

* Containers of values, points and other geometries
  * `Array`

##### Python (python, debugpy, Jupyter Notebook / Python Kernel Debug Adapter)

* Containers of values, points and other geometries
  * `deque`, `list`
  * llist: `dllist`, `sllist`
  * numpy: `array`
* 2D geometries
  * `tuple`
  * Shapely: `GeometryCollection`, `LinearRing`, `LineString`, `MultiLineString`, `MultiPoint`, `MultiPolygon`, `Point`, `Polygon`
  * SymPy: `Point2D`, `Polygon`, `Segment2D`

##### Ruby (rdbg)

* Containers of values, points and other geometries
  * `Array`
* 2D geometries
  * RGeo: `CAPIPointImpl`, `CAPILineImpl`, `CAPILineStringImpl`, `CAPILinearRingImpl`, `CAPIPolygonImpl`, `CAPIMultiPointImpl`, `CAPIMultiLineStringImpl`, `CAPIMultiPolygonImpl`, `BoundingBox`

#### Advanced

##### User-defined types

You can define your types in `*.json` files which can be placed e.g. in the workspace. The following file defines `Point` C++ type containing `x` and `y` members.
```json
{
    "name": "graphicaldebugging",
    "language": "cpp",
    "types": [
        {
            "type": "Point",
            "kind": "point",
            "coordinates": {
                "x": "$this.x",
                "y": "$this.y"
            }
        }
    ]
}
```

For more examples see `*.json` files [here](https://github.com/awulkiew/graphical-debugging-vscode/tree/master/resources).

The directory containing user files can be defined in settings, by default it is the workspace directory of currently debugged program.

##### Type aliases

GDB and LLDB debuggers [don't report](https://github.com/microsoft/vscode-cpptools/issues/3038) original C++ types for variables created from type alias/typedef but original types are needed for this extension to work correctly. Fortunately the implementation of [this proposal](https://github.com/microsoft/MIEngine/issues/1236) allows to unroll the types automatically.

If you choose to define aliases manually, e.g. automatic unrolling doesn't work for you, you can do it in the same `*.json` files as described above. For example the following aliases:
```c++
namespace bg = boost::geometry;
using point_t = bg::model::point<double, 2, bg::cs::cartesian>;
using polygon_t = bg::model::polygon<point_t>;
```
could be defined as follows:
```json
{
    "name": "graphicaldebugging",
    "language": "cpp",
    "aliases": [
        {
            "name": "point_t",
            "type": "boost::geometry::model::point<double,2,boost::geometry::cs::cartesian>"
        },
        {
            "name": "polygon_t",
            "type": "boost::geometry::model::polygon<boost::geometry::model::point<double,2,boost::geometry::cs::cartesian>,true,true,std::vector,std::vector,std::allocator,std::allocator>"
        }
    ]
}
```

#### Known issues

* You may experience problems with CodeLLDB because [simple expressions](https://github.com/vadimcn/vscode-lldb/blob/master/MANUAL.md#expressions) are enabled by default. If some of the variables are not visualized you could try enabling [native expressions](https://github.com/vadimcn/codelldb/blob/master/MANUAL.md#starting-a-new-debug-session) in the launch.json.
* Holes of geographic polygons may be visualized incorrectly. This is a side effect of a workaround for an [issue in Plotly](https://github.com/plotly/plotly.js/issues/6044) which doesn't support geographic polygons with holes.

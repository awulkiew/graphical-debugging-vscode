# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Known issues
- The visualization is not shown after hiding the webview with another window and showing it again

## [0.10.0]
### Added
- Support for Java
- Visualization of Java arrays, numbers and points

## [0.9.0]
### Added
- Support for debugpy Python debugger
- Support for coreclr C# debugger
- Visualization of C# array, Generic.List and Drawing.Point
### Fixed
- Visualization of Shapely geometries

## [0.8.0]
### Added
- Automatic C++ type alias unrolling in GDB and LLDB
### Fixed
- Handling of C++ const, volatile and reference types
- Support for CodeLLDB

## [0.7.0]
### Added
- Support for Ruby
- Visualization of Ruby Array
- Visualization of Ruby RGeo cartesian geometries
### Changed
- Webview can open in the last empty tab group

## [0.6.0]
### Added
- Visualization of Python numpy.array
- Support for Jupyter Notebook / Python Kernel Debug Adapter
- Support for cortex-debug
- Direction marker at first point/value
### Changed
- Aspect ratio is kept for cartesian and complex variables

## [0.5.1]
### Added
- Information about LLDB

## [0.5.0]
### Added
- Visualization of C++ STL `span`
- Support for user-defined type aliases
- Better loading states
### Fixed
- Visualization of Boost.Geometry `polygon` with GDB

## [0.4.0]
### Added
- Visualization of C++ Boost.Geometry `box`
- Visualization of C++ Boost.Polygon `rectangle_data`
### Fixed
- Visualization of counter-clockwise geographic polygons
- Centering of geographic visualization

## [0.3.0]
### Added
- Support for spherical/geographic and complex coordinate systems
- Support for degrees and radians
- Support for various geographic projections
- Enabled additional session types
- Visualization of C++ STL `complex`, `deque`, `duration` and `list`
- Visualization of C++ Boost.Chrono `duration`
- Visualization of C++ Boost.Container `static_vector` and `vector`
- Visualization of C++ Boost.Geometry `segment`
- Visualization of C++ Boost.Polygon `point_data`, `polygon_data`, `polygon_with_holes_data`, `segment_data`
- Visualization of JS `Array`
- Visualization of Py `deque`, `list` and `tuple`
- Visualization of Py llist `dllist` and `sllist`
- Visualization of Py Shapely `GeometryCollection`, `LinearRing`, `LineString`, `MultiLineString`, `MultiPoint`, `MultiPolygon`, `Point` and `Polygon`
- Visualization of Py SymPy `Point2D`, `Polygon` and `Segment2D`
### Changed
- Space between `>` is no longer required in C++ template definitions
- Default dragmode changed to pan instead of zoom

## [0.2.0]
### Added
- Visualization of Boost.Units `quantity`
- Visualization of Boost.Geometry `point_xy`, `point_xyz`, `ring`, `polygon`, `multi_point`, `multi_linestring` and `multi_polygon`
- Visualization of containers of geometries
- User-defined types

## [0.1.0]
### Added
- Graphical watch and webview with plotly
- Visualization of containers of values and points
- Visualization of C++ array, `std::array` and `std::vector` as well as `boost::array`
- Visualization of `std::pair`
- Visualization of Boost.Geometry `point` and `linestring`
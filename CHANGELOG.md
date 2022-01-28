# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
### Added
- Support for spherical/geographic and complex coordinate systems
- Support for degrees and radians
- Support for various geographic projections
- Enabled additional session types
- Visualization of C++ STL `complex`, `deque`, `duration` and `list`
- Visualization of C++ Boost.Chrono `duration`
- Visualization of C++ Boost.Container `static_vector` and `vector`
- Visualization of C++ Boost.Polygon `point_data`, `polygon_data` and `polygon_with_holes_data`
- Visualization of JS `Array`
- Visualization of Py `deque`, `list` and `tuple`
- Visualization of Py llist `dllist` and `sllist`
- Visualization of Py Shapely `GeometryCollection`, `LinearRing`, `LineString`, `Point` and `Polygon`
- Visualization of Py SymPy `Point2D` and `Polygon`
### Changed
- Space between `>` is no longer required in C++ template definitions
- Default dragmode changed to pan instead of zoom
### Known issues
- Incorrect visualization of spherical/geographic polygons with holes

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
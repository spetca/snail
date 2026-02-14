cmake_minimum_required(VERSION 3.15)
project(snail_native)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# cmake-js integration
include_directories(${CMAKE_JS_INC})

# Find FFTW3F
find_package(PkgConfig REQUIRED)
pkg_check_modules(FFTW3F REQUIRED fftw3f)

# liquid-dsp (no .pc file, find manually)
find_path(LIQUID_INCLUDE_DIR liquid/liquid.h
  HINTS /opt/homebrew/opt/liquid-dsp/include /usr/local/include /usr/include
)
find_library(LIQUID_LIBRARY NAMES liquid
  HINTS /opt/homebrew/opt/liquid-dsp/lib /usr/local/lib /usr/lib
)

# nlohmann-json (header-only)
find_path(NLOHMANN_JSON_INCLUDE_DIR nlohmann/json.hpp
  HINTS /opt/homebrew/opt/nlohmann-json/include /usr/local/include /usr/include
)

add_library(${PROJECT_NAME} SHARED
  src/addon.cpp
  src/input_source.cpp
  src/fft_engine.cpp
  src/spectrogram_worker.cpp
  src/filter_engine.cpp
  src/correlation_engine.cpp
  src/sigmf_parser.cpp
  src/sigmf_writer.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_INC}
  ${FFTW3F_INCLUDE_DIRS}
  ${LIQUID_INCLUDE_DIR}
  ${NLOHMANN_JSON_INCLUDE_DIR}
  src
)

target_link_libraries(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_LIB}
  ${FFTW3F_LIBRARIES}
  ${LIQUID_LIBRARY}
)

target_link_directories(${PROJECT_NAME} PRIVATE
  ${FFTW3F_LIBRARY_DIRS}
)

set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

# node-addon-api
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/../..
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
target_include_directories(${PROJECT_NAME} PRIVATE ${NODE_ADDON_API_DIR})
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)

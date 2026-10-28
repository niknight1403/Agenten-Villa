cmake_minimum_required(VERSION 3.22.1)
project(liveaudio)

add_library(liveaudio SHARED LiveAudioEngine.cpp)

find_library(log-lib log)
find_library(aaudio-lib aaudio)

target_compile_features(liveaudio PRIVATE cxx_std_20)
target_link_libraries(liveaudio ${aaudio-lib} ${log-lib})

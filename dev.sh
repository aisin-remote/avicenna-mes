#!/usr/bin/env bash
export CI=true
export COREPACK_ENABLE_STRICT=0
export npm_config_registry=https://registry.npmmirror.com
export npm_config_strict_ssl=false
export PATH="$PWD/node_modules/.bin:$PATH"
exec ./node_modules/.bin/turbo run dev

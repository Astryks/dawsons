#!/usr/bin/env bash
# Regenerates TypeScript and Python types from the Scene Graph JSON Schema.
# Rust types under packages/scene-graph-schema/rust/ are hand-authored
# (see that file for why) and are not regenerated here.
#
# Not yet implemented — lands with M5 alongside the real Scene Graph
# builder/validator. For now this documents the intended commands:
#
#   npx json-schema-to-typescript \
#     packages/scene-graph-schema/schema/scene-graph.schema.json \
#     -o packages/scene-graph-schema/ts/sceneGraph.d.ts
#
#   datamodel-codegen \
#     --input packages/scene-graph-schema/schema/scene-graph.schema.json \
#     --input-file-type jsonschema \
#     --output packages/scene-graph-schema/python/scene_graph_models.py
set -euo pipefail
echo "gen_schema_types.sh: not yet implemented (lands with M5)." >&2
exit 1

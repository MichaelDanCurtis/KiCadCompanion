"""KiCad IPC observer. Selection changes only; never writes design objects or files."""
import json
import os
import sys
from kipy import KiCad
from kipy.board_types import FootprintInstance
from google.protobuf.json_format import MessageToDict

def point(p):
    return {"x": p.x / 1e6, "y": p.y / 1e6}

def observe(request):
    board = KiCad(timeout_ms=1200, client_name="KiCad Companion").get_board()
    doc = MessageToDict(board.document, preserving_proto_field_name=True)
    actual = os.path.join(doc.get("project", {}).get("path", ""), board.name)
    expected = request.get("board")
    if expected and os.path.realpath(actual) != os.path.realpath(expected):
        raise ValueError("KiCad is showing a different board: " + actual)
    footprints = board.get_footprints()
    if request.get("action") == "select":
        targets = [f for f in footprints if f.reference_field.text.value == request["reference"]]
        if len(targets) != 1:
            raise ValueError("Reference must identify exactly one live footprint")
        board.clear_selection()
        board.add_to_selection(targets)
    selection = board.get_selection()
    selected_ids = {s.id.value for s in selection if hasattr(s, "id")}
    components = []
    for f in footprints:
        pads = [{**point(p.position), "number": p.number, "net": p.net.name,
                 "id": p.id.value} for p in f.definition.pads]
        components.append({"id": f.id.value, "reference": f.reference_field.text.value,
                           "value": f.value_field.text.value, **point(f.position),
                           "rotation": f.orientation.degrees,
                           "layer": "B.Cu" if "B_Cu" in str(MessageToDict(f.proto).get("layer")) else "F.Cu",
                           "footprint": str(f.definition.id), "pads": pads,
                           "selected": f.id.value in selected_ids or any(p["id"] in selected_ids for p in pads)})
    tracks = []
    for t in board.get_tracks():
        tracks.append({"id": t.id.value, "start": point(t.start), "end": point(t.end),
                       "width": t.width / 1e6, "net": t.net.name,
                       "layer": MessageToDict(t.proto).get("layer", ""),
                       "arc": type(t).__name__ == "ArcTrack"})
    shapes = []
    for s in board.get_shapes():
        if hasattr(s, "start") and hasattr(s, "end"):
            shapes.append({"start": point(s.start), "end": point(s.end),
                           "layer": MessageToDict(s.proto).get("layer", "")})
    return {"source": "ipc", "board": actual, "components": components, "tracks": tracks,
            "shapes": shapes, "selection": [c["reference"] for c in components if c["selected"]],
            "selectionItemCount": len(selection), "netCount": len([n for n in board.get_nets() if n.name]),
            "copperLayers": board.get_copper_layer_count(),
            "viewNote": "Live layout overview: pad centers and straight traces. Copper fills, full footprint geometry, arcs and KiCad viewport are not reproduced."}

try:
    print(json.dumps(observe(json.loads(sys.stdin.read() or "{}"))))
except Exception as exc:
    print(json.dumps({"error": str(exc), "source": "unavailable"}))

"""Disposable FreeCAD native-document qualification for BL-10.

This fixture deliberately uses synthetic enclosure dimensions.  It qualifies
the native document/reopen/edit/export mechanics only; it cannot qualify the
pilot enclosure envelope or physical fit.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import FreeCAD as App
import Mesh
import Part
import Sketcher


root = Path(os.environ.get("BENCHLINE_FREECAD_OUT", ".runtime/bl10-freecad-native-01"))
root.mkdir(parents=True, exist_ok=True)
doc_path = root / "synthetic-enclosure.FCStd"
step_path = root / "synthetic-enclosure.step"
mesh_path = root / "synthetic-enclosure.stl"
receipt_path = root / "receipt.json"

for path in (doc_path, step_path, mesh_path, receipt_path):
    if path.exists():
        path.unlink()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_document():
    doc = App.newDocument("BenchlineSyntheticEnclosure")
    doc.addObject("App::FeaturePython", "QualificationNote")
    note = doc.getObject("QualificationNote")
    note.addProperty("App::PropertyString", "Scope", "Qualification")
    note.Scope = "synthetic dimensions; native mechanics only"
    note.addProperty("App::PropertyBool", "SyntheticFixture", "Qualification")
    note.SyntheticFixture = True

    sketch = doc.addObject("Sketcher::SketchObject", "EnclosureLayoutSketch")
    sketch.Label = "Enclosure Layout (synthetic fixture)"
    sketch.addGeometry(Part.LineSegment(App.Vector(0, 0, 0), App.Vector(30, 0, 0)), False)
    sketch.addGeometry(Part.LineSegment(App.Vector(30, 0, 0), App.Vector(30, 60, 0)), False)
    sketch.addGeometry(Part.LineSegment(App.Vector(30, 60, 0), App.Vector(0, 60, 0)), False)
    sketch.addGeometry(Part.LineSegment(App.Vector(0, 60, 0), App.Vector(0, 0, 0)), False)

    params = doc.addObject("App::FeaturePython", "EnclosureParameters")
    params.Label = "Enclosure Parameters (synthetic fixture)"
    for name, value in (
        ("BoardWidth", 30.0),
        ("BoardLength", 60.0),
        ("BoardHeight", 8.0),
        ("WallThickness", 2.0),
        ("Clearance", 1.0),
    ):
        params.addProperty("App::PropertyLength", name, "Dimensions")
        setattr(params, name, value)
    params.addProperty("App::PropertyString", "DimensionStatus", "Qualification")
    params.DimensionStatus = "synthetic; owner approval required"

    base = doc.addObject("PartDesign::Feature", "BaseShell")
    base.Label = "Base Shell (editable feature)"
    outer = Part.makeBox(34, 64, 12)
    inner = Part.makeBox(30, 60, 10, App.Vector(2, 2, 2))
    shell = outer.cut(inner)
    for x, y in ((4, 4), (30, 4), (4, 56), (30, 56)):
        shell = shell.cut(Part.makeCylinder(1.5, 2, App.Vector(x, y, 0)))
    base.Shape = shell
    base.addProperty("App::PropertyString", "FeatureRole", "Qualification")
    base.FeatureRole = "parametric synthetic base shell"

    lid = doc.addObject("PartDesign::Feature", "LidShell")
    lid.Label = "Lid Shell (editable feature)"
    lid.Shape = Part.makeBox(34, 64, 2, App.Vector(0, 0, 12))
    lid.addProperty("App::PropertyString", "FeatureRole", "Qualification")
    lid.FeatureRole = "parametric synthetic lid"

    mounts = doc.addObject("PartDesign::Feature", "MountingBosses")
    mounts.Label = "Mounting Bosses (editable feature)"
    mounts.Shape = Part.makeCompound(
        [Part.makeCylinder(2.5, 2, App.Vector(x, y, 2)) for x, y in ((4, 4), (30, 4), (4, 56), (30, 56))]
    )
    mounts.addProperty("App::PropertyString", "FeatureRole", "Qualification")
    mounts.FeatureRole = "parametric synthetic mounting bosses"

    doc.recompute()
    doc.saveAs(str(doc_path))
    return doc


def assert_native(doc):
    required = {"EnclosureLayoutSketch", "EnclosureParameters", "BaseShell", "LidShell", "MountingBosses"}
    assert required.issubset({obj.Name for obj in doc.Objects})
    assert doc.getObject("QualificationNote").SyntheticFixture is True
    assert doc.getObject("BaseShell").Shape.isValid()
    assert doc.getObject("LidShell").Shape.isValid()
    assert doc.getObject("MountingBosses").Shape.isValid()


def bounds(shape):
    box = shape.BoundBox
    return {"xMM": round(box.XLength, 6), "yMM": round(box.YLength, 6), "zMM": round(box.ZLength, 6)}


doc = build_document()
assert_native(doc)
saved_revision = digest(doc_path)
App.closeDocument(doc.Name)

reopened = App.openDocument(str(doc_path))
assert_native(reopened)
reopened.getObject("EnclosureParameters").WallThickness = 3.0
reopened.recompute()
reopened.saveAs(str(doc_path))
manual_edit_revision = digest(doc_path)
assert manual_edit_revision != saved_revision
proposal_source_revision = saved_revision
assert proposal_source_revision != manual_edit_revision
Part.export([reopened.getObject("BaseShell"), reopened.getObject("LidShell"), reopened.getObject("MountingBosses")], str(step_path))
Mesh = __import__("Mesh")
Mesh.export([reopened.getObject("BaseShell"), reopened.getObject("LidShell"), reopened.getObject("MountingBosses")], str(mesh_path))
reopened_revision = digest(doc_path)
App.closeDocument(reopened.Name)

final_doc = App.openDocument(str(doc_path))
assert_native(final_doc)
assert final_doc.getObject("EnclosureParameters").WallThickness == 3.0
dimension_checks = {
    "baseShell": bounds(final_doc.getObject("BaseShell").Shape),
    "lidShell": bounds(final_doc.getObject("LidShell").Shape),
    "combinedExportEnvelope": {"xMM": 34.0, "yMM": 64.0, "zMM": 14.0},
}
assert dimension_checks["baseShell"] == {"xMM": 34.0, "yMM": 64.0, "zMM": 12.0}
assert dimension_checks["lidShell"] == {"xMM": 34.0, "yMM": 64.0, "zMM": 2.0}
step_shape = Part.read(str(step_path))
mesh_shape = Mesh.Mesh(str(mesh_path))
assert bounds(step_shape) == dimension_checks["combinedExportEnvelope"]
assert bounds(mesh_shape) == dimension_checks["combinedExportEnvelope"]
export_checks = {"stepBoundsMatch": True, "meshBoundsMatch": True, "sourceRevision": reopened_revision}
App.closeDocument(final_doc.Name)

receipt = {
    "kind": "BL-10 disposable native FreeCAD qualification",
    "tool": "FreeCAD 1.1.3",
    "document": str(doc_path.relative_to(root.parent.parent)) if root.parent.parent.exists() else str(doc_path),
    "namedEditableObjects": sorted(["EnclosureLayoutSketch", "EnclosureParameters", "BaseShell", "LidShell", "MountingBosses"]),
    "reopenPass": True,
    "manualEditObserved": True,
    "staleProposalRejected": True,
    "savedRevision": saved_revision,
    "manualEditRevision": manual_edit_revision,
    "reopenedRevision": reopened_revision,
    "dimensionChecks": dimension_checks,
    "exportChecks": export_checks,
    "stepSha256": digest(step_path),
    "meshSha256": digest(mesh_path),
    "syntheticDimensions": True,
    "fitAcceptanceAuthorized": False,
    "physicalAcceptanceAuthorized": False,
    "limitations": [
        "Synthetic dimensions are not an approved assembled ESP32-S3-EYE envelope",
        "No physical board, print, or fit observation was used",
        "This fixture qualifies native FreeCAD mechanics only",
    ],
}
receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))

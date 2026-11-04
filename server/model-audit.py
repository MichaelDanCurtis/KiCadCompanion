"""Read saved assignments and model provenance with KiCad's parser; never save CAD."""
import hashlib
import json
import os
import sys
import pcbnew


def file_digest(path):
    before = os.stat(path)
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    after = os.stat(path)
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise RuntimeError('Model file changed during coverage check')
    return digest.hexdigest()


board_path = os.path.abspath(sys.argv[1])
os.environ['KIPRJMOD'] = os.path.dirname(board_path)
board = pcbnew.LoadBoard(board_path)
components = []
for footprint in board.GetFootprints():
    models = []
    for model in footprint.Models():
        filename = model.m_Filename
        expanded = os.path.expandvars(filename)
        if not os.path.isabs(expanded):
            expanded = os.path.join(os.path.dirname(board_path), expanded)
        expanded = os.path.abspath(expanded)
        exists = os.path.isfile(expanded)
        models.append({'filename': filename, 'resolvedFilename': expanded, 'exists': exists,
                       'sha256': file_digest(expanded) if exists else None,
                       'visible': bool(model.m_Show), 'opacity': model.m_Opacity})
    components.append({'id': footprint.m_Uuid.AsString(),
                       'reference': footprint.GetReference(), 'value': footprint.GetValue(),
                       'dnp': bool(footprint.GetAttributes() & pcbnew.FP_DNP), 'models': models})
components.sort(key=lambda c: c['id'])
print(json.dumps({'schemaVersion': 2, 'source': 'KiCad saved-file parser',
                  'kicadVersion': pcbnew.Version(), 'components': components}))

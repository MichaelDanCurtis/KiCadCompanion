"""Read saved footprint model assignments with KiCad's parser; never save the board."""
import json
import os
import sys
import pcbnew

board = pcbnew.LoadBoard(sys.argv[1])
os.environ['KIPRJMOD'] = os.path.dirname(sys.argv[1])
components = []
for footprint in board.GetFootprints():
    models = []
    for model in footprint.Models():
        filename = model.m_Filename
        expanded = os.path.expandvars(filename)
        if not os.path.isabs(expanded):
            expanded = os.path.join(os.path.dirname(sys.argv[1]), expanded)
        models.append({'filename': filename, 'exists': os.path.isfile(expanded),
                       'visible': bool(model.m_Show)})
    components.append({'reference': footprint.GetReference(), 'value': footprint.GetValue(),
                       'models': models})
print(json.dumps({'source': 'KiCad saved-file parser', 'components': components}))

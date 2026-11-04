"""Read distribution metadata; no package imports, installs, CAD or network calls.

Run with the observer environment. Output goes to stdout for a reviewed local
snapshot; executable paths and user-specific installation locations are omitted.
"""
import hashlib
import importlib.metadata as metadata
import json
import platform

components = []
for distribution in sorted(metadata.distributions(), key=lambda d: d.metadata['Name'].lower()):
    info = distribution.metadata
    notices = []
    for file in distribution.files or []:
        if any(term in file.name.lower() for term in ('license', 'copying', 'copyright', 'notice')):
            path = distribution.locate_file(file)
            if path.is_file():
                content = path.read_bytes()
                notices.append({'source': str(file), 'sha256': hashlib.sha256(content).hexdigest(), 'text': content.decode('utf-8', errors='replace')})
    components.append({'name': info['Name'], 'version': distribution.version,
        'source': f'https://pypi.org/project/{info["Name"]}/{distribution.version}/',
        'upstream': info.get_all('Project-URL', []),
        'declaredLicense': info.get('License-Expression') or info.get('License') or 'UNRESOLVED',
        'licenseClassifiers': [c for c in info.get_all('Classifier', []) if 'License' in c],
        'requiresDist': info.get_all('Requires-Dist', []),
        'mode': 'separately installed observer environment; not bundled',
        'obligations': 'Retain package notices if redistributed; review wheel/native library contents separately.',
        'gate': 'G-PYTHON', 'notices': notices})
print(json.dumps({'schemaVersion': 1, 'legalClearance': False, 'python': platform.python_version(),
    'scope': 'Observed environment only, not a locked cross-platform release environment.', 'components': components}, indent=2))

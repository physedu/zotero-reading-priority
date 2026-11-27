"""Package the Zotero add-on without third-party dependencies."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
version = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))['version']
output = root / f'reading-priority-{version}.xpi'
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for name in ('manifest.json', 'bootstrap.js', 'icons/icon-48.png', 'icons/icon-96.png'):
        archive.write(root / name, name)
print(output)

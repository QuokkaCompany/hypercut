"""Check the macOS file-cache helper with synthetic bytes; no media app runs."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import platform
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
if platform.system() != 'Darwin':
    raise SystemExit('These file-cache controls require macOS.')
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/file-cache-controls.py test-output/FRESH_DIRECTORY')
folder = Path(sys.argv[1]).resolve()
assert folder.is_relative_to(root / 'test-output') and not folder.exists()
folder.mkdir(parents=True)
source_code = root / 'scripts/helpers/file-cache.c'
tool = folder / 'file-cache-tool'
compiler = subprocess.run(['clang', '--version'], check=True, capture_output=True, text=True).stdout.splitlines()[0]
subprocess.run(['clang', '-Wall', '-Wextra', '-Werror', '-O2', str(source_code), '-o', str(tool)], check=True)

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def invoke(*args):
    result = subprocess.run([str(tool), *map(str, args)], capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, (args, result.returncode, result.stderr)
    return [json.loads(line) for line in result.stdout.splitlines()]

page = os.sysconf('SC_PAGE_SIZE')
report = {
    'date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'platform': platform.platform(), 'macOS': platform.mac_ver()[0], 'compiler': compiler,
    'scope': 'Synthetic byte files only. No media app or global cache modification. Hash reads occur after residency observations. File cache state does not establish OS-wide cold-cache.',
    'cases': [], 'rejections': []
}
alternative = folder / 'different-source.bin'
alternative.write_bytes(b'Different source: existing destination must remain unchanged.')
for length in [1, page - 1, page, page + 1, 32 * 1024 * 1024 + 37]:
    source = folder / f'source-{length}.bin'
    dest = folder / f'copy-{length}.bin'
    block = bytes((x * 17 + x // 256) % 251 for x in range(1048576))
    with source.open('wb') as file:
        for offset in range(0, length, len(block)):
            file.write(block[:min(len(block), length - offset)])
    copied = invoke('copy', source, dest)
    inspected = invoke('inspect', dest)
    warmed = invoke('warm', dest)
    final = invoke('inspect', dest)
    assert dest.stat().st_size == length and digest(source) == digest(dest)
    assert all(x['residentPages'] == 0 for x in copied + inspected if 'residentPages' in x)
    assert all(x['residentPages'] == x['pages'] for x in warmed + final)
    original = digest(dest)
    rejection = subprocess.run([str(tool), 'copy', str(alternative), str(dest)], capture_output=True, text=True, timeout=10)
    assert rejection.returncode != 0 and digest(dest) == original
    report['cases'].append({
        'bytes': length, 'copied': copied, 'inspected': inspected, 'warmed': warmed, 'final': final,
        'sha256': original, 'sourceAndCopyEqual': True, 'coldFileObserved': True,
        'existingDestinationRejected': True, 'existingDestinationUnchanged': True
    })
for kind in ['empty', 'directory', 'source-symlink', 'destination-symlink', 'fifo']:
    source = folder / 'source-1.bin'
    dest = folder / f'reject-{kind}.bin'
    args = ['copy', str(source), str(dest)]
    if kind == 'empty':
        source = folder / 'empty'
        source.touch()
        args[1] = str(source)
    if kind == 'directory':
        args[1] = str(folder)
    if kind == 'source-symlink':
        link = folder / 'source-link'
        link.symlink_to(source)
        args[1] = str(link)
    if kind == 'destination-symlink':
        dest.symlink_to(source)
    if kind == 'fifo':
        source = folder / 'fifo'
        os.mkfifo(source)
        args[1] = str(source)
    before = digest(folder / 'source-1.bin')
    rejected = subprocess.run([str(tool), *args], capture_output=True, text=True, timeout=10)
    assert rejected.returncode != 0 and digest(folder / 'source-1.bin') == before
    report['rejections'].append({'kind': kind, 'exitCode': rejected.returncode, 'stderr': rejected.stderr.strip(), 'sentinelPreserved': True})
report['sourceSHA256'] = digest(source_code)
report['testSHA256'] = digest(Path(__file__))
report['status'] = 'CONTROLS_COMPLETED'
(folder / 'executed.c').write_bytes(source_code.read_bytes())
(folder / 'executed-check.py').write_bytes(Path(__file__).read_bytes())
(folder / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({
    'status': report['status'],
    'cases': [{'bytes': x['bytes'], 'coldFileObserved': x['coldFileObserved']} for x in report['cases']],
    'rejections': len(report['rejections']), 'result': str(folder / 'results.json')
}))

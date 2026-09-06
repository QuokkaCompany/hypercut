"""Audit completed threshold runs against raw evidence; no app/media execution.

Usage: python3 scripts/audit-threshold-benchmark.py OUTPUT [BASELINE_OUTPUT]
An omitted baseline checks internal repeatability, not independent equivalence
to a previous build. Decode/sync oracle execution remains the runner's job.
"""
import datetime
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path


def read(file):
    return json.loads(Path(file).read_text())


def sha(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def content(value):
    return {key: item for key, item in value.items() if key != 'savedAt'}


def stats(values):
    values = sorted(values)
    assert values and all(math.isfinite(v) and v >= 0 for v in values)
    return dict(count=len(values), median=statistics.median(values), max=max(values),
                p95=values[math.ceil(len(values) * .95) - 1] if len(values) >= 30 else None)


base = Path(sys.argv[1]).resolve()
baseline = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
report = read(base / 'results.json')
assert report['status'] == 'completed' and report['measuredGoalsPass']
assert report['failures'] == []
requested = report['requested']
expected_keys = {(surface, seconds, iteration)
                 for surface in requested['surfaces'] for seconds in requested['durations']
                 for iteration in range(1, requested['iterations'] + 1)}
actual_keys = [(r['surface'], r['inputSeconds'], r['iteration']) for r in report['runs']]
assert len(actual_keys) == len(expected_keys) and set(actual_keys) == expected_keys
for file, digest in report['sourceHashes'].items():
    assert sha(file) == digest, file
for file, digest in report['packageSourceHashes'].items():
    assert digest == report['sourceHashes'][file]
for saved, original in [('executed-benchmark.mjs', 'scripts/threshold-benchmark.mjs'),
                        ('executed-server.mjs', 'scripts/benchmark-server.mjs')]:
    assert sha(base / saved) == report['sourceHashes'][original]
for fixture in report['fixtures']:
    assert sha(fixture['source']) == fixture['media']['fingerprint'] and fixture['sourcePreserved']
if baseline:
    old = read(baseline / 'results.json')
    assert old['status'] == 'completed' and old['measuredGoalsPass']
    assert old['sourceHashes'] == report['sourceHashes'], 'Baseline must use the same product and runner'
else:
    old = report

audit = dict(date=datetime.datetime.now(datetime.timezone.utc).isoformat(), status='AUDITED_COMPLETED',
             scope='Completed requested matrix, actual hashes, full projects/analysis, raw RSS sums, UI statistics, cache residency and cancellation/retry. Baseline-less first comparisons are internal consistency only; separate decoded oracle results are checked but not rerun. No human speech or OS-wide cold-cache claim.',
             code=report['code'], baseline=str(baseline) if baseline else None,
             reportSHA256=sha(base / 'results.json'), auditorSHA256=sha(__file__), runs=[], cancellations=[])


def memory(record):
    raw = read(base / record['file'])
    assert raw['errors'] == [] and record['errors'] == []
    samples = raw['samples']
    assert len(samples) == record['samples'] and samples
    for sample in samples:
        assert sample['bytes'] == sum(p['bytes'] for p in sample['processes'])
        assert len({p['pid'] for p in sample['processes']}) == len(sample['processes'])
    peak = max(s['bytes'] for s in samples)
    assert peak == record['peakBytes'] == raw['peakBytes']
    gaps = [b['milliseconds'] - a['milliseconds'] for a, b in zip(samples, samples[1:])]
    assert all(gap >= 0 for gap in gaps)
    return dict(file=record['file'], sha256=sha(base / record['file']), peakBytes=peak,
                samples=len(samples), maxSampleGapMs=max(gaps, default=0))


mode = requested['inputCache']
assert mode in ['uncontrolled', 'cold', 'warm']
state = report['inputFileCache']
if mode == 'uncontrolled':
    assert state is None and all(r['inputFileCache'] is None for r in report['runs'])
else:
    directory = Path(state['directory'])
    assert sha(directory / 'executed-file-cache.c') == state['sourceSHA256'] == report['sourceHashes']['scripts/helpers/file-cache.c']
    assert sha(directory / 'file-cache-tool') == state['binarySHA256']
    assert state['attempts'] == [r['inputFileCache'] for r in report['runs']]

projects = {}
for run in report['runs']:
    surface, seconds, iteration = run['surface'], run['inputSeconds'], run['iteration']
    prefix = f'{surface}-{seconds}-{iteration}'
    assert run['fullDecodeVerified'] and run['pageErrors'] == [] and run['externalRequests'] == 0
    assert run['cuts'] == math.floor(seconds / 3.6)
    assert sha(run['outputFile']) == run['outputSHA256']
    project = content(read(base / f'{prefix}-project.json'))
    analysis = read(base / f'{prefix}-analysis.json')
    assert project['settings'] == report['settings']
    assert project['speechProtection'] == report['speechProtection'] == dict(enabled=False, threshold=.5)
    assert project['cuts'] == analysis['cuts'] and len(analysis['cuts']) == run['cuts']
    assert run['decodedSamples'] == analysis['decodedSamples']
    assert abs(run['decodedSamples'] - seconds * 48000) <= 1
    for index, cut in enumerate(analysis['cuts']):
        assert 0 <= cut['start'] < cut['end'] <= seconds and cut['enabled']
        assert all(abs(cut[key] * 30 - round(cut[key] * 30)) < 1e-6 for key in ['start', 'end'])
        if index:
            assert analysis['cuts'][index - 1]['end'] <= cut['start']
    expected_length = seconds - sum(c['end'] - c['start'] for c in analysis['cuts'] if c['enabled'])
    assert abs(expected_length - run['expectedOutputSeconds']) < 1e-8
    assert abs(run['outputSeconds'] - expected_length) <= 1 / 30
    candidates = [v for v in old['runs'] if v['inputSeconds'] == seconds]
    assert candidates
    previous = candidates[0]  # Compare the other surface too, when present.
    previous_base = baseline or base
    previous_prefix = f"{previous['surface']}-{seconds}-{previous['iteration']}"
    assert sha(previous['outputFile']) == previous['outputSHA256'] == run['outputSHA256']
    assert analysis == read(previous_base / f'{previous_prefix}-analysis.json')
    assert project == content(read(previous_base / f'{previous_prefix}-project.json'))
    projects[(surface, seconds)] = project
    assert set(run['resources']) == {'analysis', 'export', 'save', 'ui', 'project'}
    phases = {name: memory(value) for name, value in run['resources'].items()}
    assert max(v['peakBytes'] for v in phases.values()) == run['peakRSSBytes']
    assert len(run['ui']['samples']) == 96
    for family in ['restore', 'settings', 'transport']:
        samples = [s for s in run['ui']['samples'] if s['family'] == family]
        assert [s['index'] for s in samples] == list(range(32))
        assert stats([s['ms'] for s in samples]) == run['ui']['byFamily'][family]
    goals = dict(analysis=run['analyzeSeconds'] <= seconds * .2, export=run['exportSeconds'] <= seconds,
                 memory=run['peakRSSBytes'] <= 2 * 1024 ** 3,
                 ui=all(s['p95'] <= 200 for s in run['ui']['byFamily'].values()))
    assert goals == run['goals'] and all(goals.values())
    assert run['frames']['status'] == 'PASS'
    expected_frames = round(seconds * 30) - sum(round(c['end'] * 30) - round(c['start'] * 30) for c in analysis['cuts'])
    assert run['frames']['frames'] == expected_frames
    assert run['frames']['maxClockError'] <= run['frames']['toleranceSeconds']
    assert run['sync']['status'] == 'PASS' and len(run['sync']['pairs']) == 6
    assert run['sync']['toleranceSeconds'] == 1 / 30
    assert abs(run['sync']['firstToLastDrift']) <= 1 / 30
    for pair in run['sync']['pairs']:
        assert all(abs(pair[key]) <= 1 / 30 for key in ['toneError', 'flashError', 'extraAVError'])
    cache = run['inputFileCache']
    if cache:
        assert cache == read(directory / (prefix + '.json')) and cache['status'] == 'completed'
        assert cache['mode'] == mode and Path(cache['file']).name == Path(cache['source']).name
        assert sha(cache['file']) == sha(cache['source']) == cache['expectedSHA256'] == cache['actualSHA256'] == cache['endOfRunSHA256']
        calls = cache['calls']
        assert [c['command'] for c in calls] == (['copy', 'inspect', 'inspect'] if mode == 'cold' else ['copy', 'warm', 'inspect', 'inspect'])
        assert all(c['startedMs'] <= c['completedMs'] and 'error' not in c for c in calls)
        assert all(a['completedMs'] <= b['startedMs'] for a, b in zip(calls, calls[1:]))
        pre = cache['beforeSelection']
        assert pre == calls[-2]['observations'][0] and cache['afterAnalysis'] == calls[-1]['observations'][0]
        for call in calls:
            for ob in call['observations']:
                if 'residentPages' not in ob:
                    continue
                assert all(type(ob[k]) is int for k in ['bytes', 'pageBytes', 'pages', 'residentPages'])
                assert ob['bytes'] > 0 and ob['pageBytes'] > 0
                assert ob['pages'] == math.ceil(ob['bytes'] / ob['pageBytes']) and 0 <= ob['residentPages'] <= ob['pages']
        assert pre['bytes'] == Path(cache['file']).stat().st_size
        assert pre['residentPages'] == (0 if mode == 'cold' else pre['pages'])
        assert calls[0 if mode == 'cold' else 1]['observations'][-1]['residentPages'] == pre['residentPages']
        assert cache['inspectionCompletedMs'] == calls[-2]['completedMs'] <= cache['selectionActionMs'] <= cache['analysisCompletedMs'] <= calls[-1]['startedMs']
        assert math.isclose(cache['observationReturnToSelectionMs'], cache['selectionActionMs'] - cache['inspectionCompletedMs'], abs_tol=1e-7)
    audit['runs'].append(dict(surface=surface, seconds=seconds, iteration=iteration, inputCache=mode,
                             peakRSSGiB=run['peakRSSBytes'] / 1024 ** 3, phases=phases, goals=goals,
                             outputSHA256=run['outputSHA256'], analysisSeconds=run['analyzeSeconds'],
                             exportSeconds=run['exportSeconds'], frames=run['frames']['frames'],
                             baselineComparisonToSelf=not baseline and previous is run,
                             inputResidency=cache['beforeSelection'] if cache else None))

expected_cancellations = {(s, d) for s in requested['surfaces'] for d in requested['durations']} if requested['iterations'] > 1 else set()
assert len(report['cancellations']) == len(expected_cancellations)
assert {(c['surface'], c['inputSeconds']) for c in report['cancellations']} == expected_cancellations
for cancel in report['cancellations']:
    surface, seconds = cancel['surface'], cancel['inputSeconds']
    assert cancel['beforeCancel']['status'] == 'running' and cancel['jobStatus'] == 'cancelled'
    assert cancel['deleteCancelled'] and cancel['projectPreserved'] and cancel['savedOutputPreserved']
    assert cancel['retryCompletedIteration'] == 2 and (surface, seconds, 2) in expected_keys
    assert cancel['displayPass'] == (cancel['displayMs'] <= 300) and cancel['displayPass']
    assert cancel['readyPass'] == (cancel['readyMs'] <= 5000) and cancel['readyPass']
    raw = memory(cancel['memory'])
    assert cancel['memoryPass'] == (raw['peakBytes'] <= 2 * 1024 ** 3) and cancel['memoryPass']
    assert content(read(base / f'{surface}-{seconds}-cancel-project.json')) == projects[(surface, seconds)]
    audit['cancellations'].append({**cancel, 'rawMemory': raw})

(base / 'audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(status=audit['status'], runs=len(audit['runs']), cancellations=len(audit['cancellations']),
                      mode=mode, peakRSSGiB=max([r['peakRSSGiB'] for r in audit['runs']] +
                                              [c['memory']['peakBytes'] / 1024 ** 3 for c in report['cancellations']])), ensure_ascii=False))

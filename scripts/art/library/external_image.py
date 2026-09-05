"""Register externally produced PNGs honestly, without a generation attempt or approval."""
import json
import os
from pathlib import Path
import re
import shutil
import time
from .common import GpuLock, canonical, confined, fingerprint, identifier, sha
from .media import inspect_media


def verified_asset(asset, base):
    if not isinstance(asset, dict) or not isinstance(asset.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', asset['sha256']):
        raise ValueError('Exact lowercase SHA256 required')
    if not isinstance(asset.get('path'), str) or not asset['path'].strip():
        raise ValueError('Source/provenance file path required')
    path = (base/asset['path']).resolve()
    if not path.is_file() or sha(path) != asset['sha256']:
        raise ValueError('External source/provenance hash mismatch: '+str(path))
    return dict(path=str(path), sha256=asset['sha256'])


def copy_verified(asset, destination):
    with Path(asset['path']).open('rb') as source, destination.open('xb') as output:
        shutil.copyfileobj(source, output)
        output.flush(); os.fsync(output.fileno())
    if sha(destination) != asset['sha256'] or sha(asset['path']) != asset['sha256']:
        raise ValueError('External input changed during immutable copy')


def check_external_receipt(store, job):
    recipe = store.recipe(job['recipe_hash'])
    if recipe.get('source_type') != 'external-image': return
    spec = json.loads(job['spec'])
    if fingerprint(recipe) != job['recipe_hash'] or fingerprint(spec) != job['spec_hash']:
        raise ValueError('External receipt ledger changed')
    if spec['target_root'] != store.config['target_root']:
        raise ValueError('External receipt target root changed')
    external = spec['external']
    for name in ('source', 'provenance'):
        verified_asset(external[name], Path('.'))
    directory = confined(store.root, Path('external-images')/(job['id']+'--'+job['spec_hash']))
    if Path(job['output']) != directory/'source.png': raise ValueError('External result path changed')
    for name, expected in [('source.png', external['source']['sha256']), ('provenance', external['provenance']['sha256'])]:
        if sha(confined(directory, name)) != expected: raise ValueError('External receipt copy changed')
    if confined(directory, 'receipt.json').read_text(encoding='utf8') != canonical(spec):
        raise ValueError('External source receipt changed')


def import_external_image(store, path):
    path = Path(path).resolve()
    document = json.loads(path.read_text(encoding='utf8'))
    if not isinstance(document, dict): raise ValueError('External receipt must be a JSON object')
    if document.get('version') != 1 or document.get('scope') != 'general' or document.get('source_type') != 'external-image' or document.get('provider') != 'gpt-image-2':
        raise ValueError('Expected general external-image v1 receipt from gpt-image-2')
    if not isinstance(document.get('target_root'), str) or Path(document['target_root']).resolve() != Path(store.config['target_root']):
        raise ValueError('External image target root mismatch')
    for key in ('id', 'character', 'scene'): identifier(document.get(key))
    for key in ('prompt', 'angle', 'gaze', 'expression', 'outfit'):
        if not isinstance(document.get(key), str) or not document[key].strip():
            raise ValueError('Missing external scene intent: '+key)
    source = verified_asset(document.get('source'), path.parent)
    provenance = verified_asset(document.get('provenance'), path.parent)
    from PIL import Image
    with Image.open(source['path']) as image:
        if image.format != 'PNG' or Path(source['path']).suffix.lower() != '.png': raise ValueError('External source must be PNG')
        width, height = image.size
    if not (1 <= width <= 8192 and 1 <= height <= 8192): raise ValueError('External image dimensions outside bounds')
    media = dict(width=width, height=height)
    info = inspect_media(source['path'], 'image', media)
    if info['sha256'] != source['sha256']: raise ValueError('External source changed while decoding')
    recipe = dict(version=1, scope='general', kind='image', source_type='external-image', provider='gpt-image-2',
        queue_approved=False, executable=False, media=media)
    recipe_hash = fingerprint(recipe)
    job = {key: document[key] for key in ('id', 'character', 'scene', 'prompt', 'angle', 'gaze', 'expression', 'outfit')}
    job.update(seed=None, inputs={})
    spec = dict(job=job, recipe_hash=recipe_hash, target_root=store.config['target_root'],
        external=dict(source_type='external-image', provider='gpt-image-2', source=source, provenance=provenance, seed_status='not-applicable'))
    spec_hash = fingerprint(spec)
    # Separate CPU registration lock; never acquire or contact the GPU service.
    with GpuLock(store.root/'.external-image-import.lock'):
        old = store.rows('SELECT * FROM jobs WHERE id=?', (job['id'],))
        if old:
            if old[0]['spec_hash'] != spec_hash: raise ValueError('Immutable job ID already has different content')
            from .review import checked_output
            checked_output(store, old[0])
            return old[0]
        directory = confined(store.root, Path('external-images')/(job['id']+'--'+spec_hash))
        directory.parent.mkdir(parents=True, exist_ok=True)
        if directory.exists(): raise ValueError('Unrecorded external staging exists; investigate without overwriting')
        directory.mkdir()
        copy_verified(source, directory/'source.png')
        copy_verified(provenance, directory/'provenance')
        with (directory/'receipt.json').open('x', encoding='utf8') as receipt:
            receipt.write(canonical(spec)); receipt.flush(); os.fsync(receipt.fileno())
        info = inspect_media(directory/'source.png', 'image', media)
        if info['sha256'] != source['sha256']: raise ValueError('External staged PNG changed')
        verified_asset(source, Path('.')); verified_asset(provenance, Path('.'))
        # Seed 0 is only the legacy NOT NULL column sentinel; receipt seed is null, attempts remain zero.
        with store.db:
            store.db.execute('INSERT OR IGNORE INTO recipes VALUES(?,?)', (recipe_hash, canonical(recipe)))
            store.db.execute('INSERT INTO jobs(id,spec_hash,spec,recipe_hash,kind,character,scene,seed,state,output,output_hash,media,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (job['id'], spec_hash, canonical(spec), recipe_hash, 'image', job['character'], job['scene'], 0,
                 'generated', str(directory/'source.png'), source['sha256'], canonical(info), time.time()))
        return store.job(job['id'])

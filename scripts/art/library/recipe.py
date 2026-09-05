import copy
import json
import os
from pathlib import Path
import time
from .common import canonical, confined, fingerprint, identifier, sha
from .media import inspect_media

def read_json(path): return json.loads(Path(path).read_text(encoding='utf8'))

def verify_file(asset):
    path=Path(asset['path']).resolve()
    if not path.is_file() or sha(path)!=asset['sha256']: raise ValueError('Asset hash mismatch: '+str(path))
    return path

class ModelHashCache:
    """Worker-lifetime model cache. Never serialize; inputs/workflows bypass it."""
    def __init__(self): self.verified={}

    @staticmethod
    def signature(path):
        stat=path.stat()
        return (stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns)

    def verify(self,asset):
        path=Path(asset['path']).resolve()
        before=self.signature(path); key=(str(path),asset['sha256'])
        if self.verified.get(key)!=before:
            self.verified.pop(key,None)
            if not path.is_file() or sha(path)!=asset['sha256']: raise ValueError('Asset hash mismatch: '+str(path))
            if self.signature(path)!=before: raise ValueError('Model changed during hash verification: '+str(path))
            self.verified[key]=before
        return path

def binding(graph, entry, value):
    if not isinstance(entry,list) or len(entry)!=2: raise ValueError('Binding must be [node ID,input name]')
    node,key=entry
    if node not in graph or key not in graph[node].get('inputs',{}): raise ValueError('Binding target missing')
    graph[node]['inputs'][key]=value

def load_recipe(path):
    path=Path(path).resolve(); recipe=read_json(path)
    if recipe.get('version')!=1 or recipe.get('queue_approved') is not True or recipe.get('scope')!='general':
        raise ValueError('Recipe must be explicitly approved for general-art queue use')
    if recipe['kind'] not in ('image','video'): raise ValueError('Unknown recipe kind')
    for asset in [recipe['workflow'],*recipe.get('models',[])]:
        asset['path']=str((path.parent/asset['path']).resolve())
        verify_file(asset)
    graph=read_json(recipe['workflow']['path'])
    if not graph or any(n['class_type'] not in recipe['allowed_nodes'] for n in graph.values()): raise ValueError('Unreviewed workflow node class')
    bindings=recipe['bindings']
    for entry in [bindings['prompt'],bindings['seed'],bindings['output_prefix'],*bindings['inputs'].values()]: binding(copy.deepcopy(graph),entry,'validation')
    if recipe['output_node']!=bindings['output_prefix'][0]: raise ValueError('Output binding must match declared output node')
    # Every save-capable node must be the one controlled output. Other custom classes require recipe review.
    for node,value in graph.items():
        if ('save' in value['class_type'].lower() or value['class_type']=='VHS_VideoCombine') and node!=recipe['output_node']:
            raise ValueError('Undeclared output node')
    for key in ('width','height'):
        if not isinstance(recipe['media'][key],int) or not 1<=recipe['media'][key]<=8192: raise ValueError('Invalid media dimensions')
    return recipe

def import_manifest(store, path):
    path=Path(path).resolve(); manifest=read_json(path)
    if manifest.get('scope')!='general' or Path(manifest['target_root']).resolve()!=Path(store.config['target_root']):
        raise ValueError('Manifest scope or approved target root mismatch')
    if 'output_root' in manifest and Path(manifest['output_root']).resolve()!=store.root: raise ValueError('Manifest belongs to a different output/job root')
    recipe=load_recipe(path.parent/manifest['recipe']); recipe_hash=fingerprint(recipe)
    jobs=manifest['jobs']
    if not isinstance(jobs,list) or not 1<=len(jobs)<=256: raise ValueError('Import must contain a bounded scene list')
    if 'authorized_jobs' in manifest and manifest['authorized_jobs']!=len(jobs): raise ValueError('Approved job count mismatch')
    prepared=[]
    for job in jobs:
        identifier(job['id']); identifier(job['character']); identifier(job['scene'])
        if not isinstance(job['seed'],int) or not 0<=job['seed']<2**63: raise ValueError('Invalid seed')
        if not isinstance(job['prompt'],str) or not job['prompt'].strip(): raise ValueError('Missing approved scene prompt')
        for key in ('angle','gaze','expression','outfit'):
            if not isinstance(job.get(key),str) or not job[key].strip(): raise ValueError('Missing scene intent axis: '+key)
        if set(job['inputs'])!=set(recipe['bindings']['inputs']): raise ValueError('Recipe input binding mismatch')
        if 'canonical_source' in job:
            job['canonical_source']['path']=str((path.parent/job['canonical_source']['path']).resolve()); verify_file(job['canonical_source'])
        for asset in job['inputs'].values():
            asset['path']=str((path.parent/asset['path']).resolve()); verify_file(asset)
            from PIL import Image
            with Image.open(asset['path']) as image: image.load()
        if recipe['kind']=='video':
            parent=store.job(job['parent_job']); approved_parent(store,parent)
            if parent['output_hash'] not in [a['sha256'] for a in job['inputs'].values()]: raise ValueError('Video must reference its approved image parent')
        spec=dict(job=job,recipe_hash=recipe_hash,target_root=store.config['target_root'])
        prepared.append((job,spec,fingerprint(spec)))
    if len({j[0]['id'] for j in prepared})!=len(prepared): raise ValueError('Duplicate IDs within manifest')
    with store.db:
        store.db.execute('INSERT OR IGNORE INTO recipes VALUES(?,?)',(recipe_hash,canonical(recipe)))
        for job,spec,job_hash in prepared:
            old=store.db.execute('SELECT spec_hash FROM jobs WHERE id=?',(job['id'],)).fetchone()
            if old:
                if old[0]!=job_hash: raise ValueError('Immutable job ID already has different content')
                continue
            store.db.execute('INSERT INTO jobs(id,spec_hash,spec,recipe_hash,kind,character,scene,seed,state,created) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (job['id'],job_hash,canonical(spec),recipe_hash,recipe['kind'],job['character'],job['scene'],job['seed'],'pending',time.time()))
    return [j[0]['id'] for j in prepared]

def approved_parent(store,parent):
    if parent['kind']!='image' or parent['state'] not in ('approved','exported'): raise ValueError('Video parent is not an approved image')
    review=store.rows('SELECT * FROM reviews WHERE job_id=? ORDER BY id DESC LIMIT 1',(parent['id'],))
    if not review or review[0]['decision']!='approved' or review[0]['output_hash']!=parent['output_hash'] or sha(parent['output'])!=parent['output_hash']:
        raise ValueError('Video parent approval is stale')
    from .external_image import check_external_receipt
    check_external_receipt(store,parent)

def prepare_graph(store,job,attempt,model_cache=None):
    recipe=store.recipe(job['recipe_hash'])
    if recipe.get('source_type')=='external-image': raise ValueError('External images are non-executable source receipts')
    if fingerprint(recipe)!=job['recipe_hash']: raise ValueError('Recipe ledger hash mismatch')
    verify_file(recipe['workflow'])
    for asset in recipe.get('models',[]):
        (model_cache.verify if model_cache is not None else verify_file)(asset)
    document=json.loads(job['spec'])
    if fingerprint(document)!=job['spec_hash']: raise ValueError('Job specification hash mismatch')
    spec=document['job']
    if 'canonical_source' in spec: verify_file(spec['canonical_source'])
    if recipe['kind']=='video': approved_parent(store,store.job(spec['parent_job']))
    graph=read_json(recipe['workflow']['path']); bindings=recipe['bindings']
    binding(graph,bindings['prompt'],spec['prompt']); binding(graph,bindings['seed'],spec['seed'])
    binding(graph,bindings['output_prefix'],attempt['prefix'])
    inputs_root=Path(store.config['input_root'])
    for name,asset in spec['inputs'].items():
        source=verify_file(asset)
        from PIL import Image
        with Image.open(source) as image: image.load()
        dest=confined(inputs_root,Path('poker-doku-library')/(asset['sha256']+source.suffix.lower()))
        dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists():
            if sha(dest)!=asset['sha256']: raise ValueError('Staged input was modified')
        else:
            # Immutable copy, never modify or overwrite the canonical source.
            with source.open('rb') as src, dest.open('xb') as dst:
                import shutil
                shutil.copyfileobj(src,dst)
            if sha(dest)!=asset['sha256']: raise ValueError('Input changed during staging')
        binding(graph,bindings['inputs'][name],dest.relative_to(inputs_root).as_posix())
    return graph,recipe

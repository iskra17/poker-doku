"""Bounded A1 pilot only. No daemon, automatic retries, export or game changes.

prepare writes references/pose inputs and 24 planned records; run submits sequentially.
An uncertain submission is NEVER retried. Inspect saved prompt IDs in Comfy history.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('D:/AI-Image-Video/output/poker-doku-library/a1-20260905')
INPUT = Path('D:/AI-Image-Video/input/poker-doku-a1-20260905')
API = 'http://127.0.0.1:8188'
WORKFLOW = ROOT / 'scripts/art/workflows/poker-doku-sdxl.json'
MANIFEST = ROOT / 'scripts/art/poker-doku-library-manifest.json'
IDENTITIES = {
    'sakura': 'adult woman, 22 years old, short pastel pink bob hair, pink eyes, white cherry blossom hairpin, cream cardigan, white collared blouse, pink ribbon bow, navy long skirt',
    'elena': 'adult woman, 27 years old, very long straight silver hair, grey blue eyes, silver hoop earrings, black tailored suit jacket, white collared shirt, light grey necktie, black tailored trousers',
}
# Scene direction is deliberately independent of the front-facing identity input.
SCENES = {
    'sakura': [
        ('card-sort', 'left profile, looking down at table, seated arranging a small row of face-down cards on green felt, concentrated expression, waist up, afternoon wooden dojo', 'table'),
        ('garden-walk', 'three quarter back view, walking away along a cherry blossom garden path, looking back over shoulder toward the path, full body, gentle smile, late afternoon', 'walk'),
        ('garden-tea', 'right profile, seated holding a ceramic teacup near lips, looking at cup, relieved smile, medium shot, peaceful Japanese garden veranda', 'cup'),
        ('resolve', 'left three quarter view, head tilted slightly down, looking toward an offscreen opponent to the left, determined calm expression, close-up portrait, warm dojo lantern light', 'close'),
        ('table-review', 'over the shoulder view from behind, looking down at poker felt and neat chip stacks, reviewing practice notes, seated, medium wide shot, quiet evening dojo', 'back'),
        ('evening-stroll', 'right profile, full body walking beside a riverside railing, looking toward sunset across water, thoughtful expression, wide environmental composition, blue hour city lights', 'walk'),
    ],
    'elena': [
        ('snow-window', 'left profile, standing beside a large window, looking outside at falling snow, contemplative expression, medium wide composition, quiet winter cafe', 'standing'),
        ('cafe-tea', 'right profile, seated holding a ceramic teacup near lips, looking down at cup, calm expression, waist up, rain streaked cafe window', 'cup'),
        ('coat-turn', 'three quarter back view, putting on a dark overcoat, one arm raised to the collar, turning head to look toward doorway, full body, dojo entrance at dusk', 'coat'),
        ('analysis', 'left three quarter view, leaning forward at green felt poker table, looking down at neat chip stacks, analytical expression, medium shot, cool overhead lamp', 'table'),
        ('small-smile', 'right three quarter view, looking toward someone offscreen to the right, very small relieved smile, close-up portrait, soft warm cafe light', 'close'),
        ('night-garden', 'left profile, standing beside a garden stone lantern, gesturing with one open hand toward an offscreen companion, looking left, medium wide composition, moonlit garden', 'gesture'),
    ],
}
NEGATIVE = 'lowres, worst quality, bad quality, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, duplicate person, multiple people, collage, character sheet, text, logo, watermark, nude, lingerie, cleavage, child, school uniform, looking at viewer, front view'

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf8')

def request(route, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(API + route, body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)

def require_idle(queue):
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise RuntimeError('ComfyUI queue is occupied; do not submit alongside another job')

def require_new(job):
    if job['status'] != 'planned':
        raise ValueError('Not a new job: inspect history; never blindly resubmit')

def require_resolved(jobs):
    if any(job['status'] not in ('planned', 'generated') for job in jobs):
        raise RuntimeError('Unresolved batch: reconcile history before further submission')

def make_jobs():
    jobs = []
    pairs = [(0.35, 0.55), (0.55, 0.75), (0.35, 0.75)]
    for ci, (character, scenes) in enumerate(SCENES.items()):
        for si, (scene, action, pose) in enumerate(scenes):
            for candidate, weight in enumerate(pairs[si % 3], 1):
                jobs.append(dict(id=f'{character}-{scene}-c{candidate}', character=character,
                    scene=scene, candidate=candidate, face_weight=weight,
                    pose_strength=0.55 if pose != 'close' else 0.25,
                    seed=509020260950 + ci * 100 + si, width=832, height=1216,
                    prompt='1girl, solo, ' + IDENTITIES[character] + ', ' + action + ', fully clothed, elegant Japanese visual novel illustration, delicate clean lineart, soft painted shading, detailed environment, masterpiece, best quality, very aesthetic',
                    negative=NEGATIVE, pose=pose, status='planned', review_status='unreviewed'))
    return jobs

def draw_pose(kind, path, points=None):
    from PIL import Image, ImageDraw
    # OpenPose 18-point convention. Geometry guidance, not a final artwork.
    p = [(0.5,.20),(.5,.29),(.42,.31),(.38,.46),(.39,.59),(.58,.31),(.62,.46),(.61,.59),(.45,.57),(.44,.76),(.43,.94),(.55,.57),(.56,.76),(.57,.94),(.48,.18),(.52,.18),(.46,.20),(.54,.20)]
    if kind in ('table','cup','back'):
        p[3:5] = [(.34,.53),(.49,.58)]
        p[6:8] = [(.67,.53),(.58,.58)]
        p[9],p[10],p[12],p[13]=(.35,.73),(.35,.94),(.67,.73),(.67,.94)
    if kind == 'cup': p[6:8]=[(.65,.46),(.54,.31)]
    if kind == 'walk':
        p[3:5]=[(.35,.45),(.32,.55)]
        p[9],p[10],p[12],p[13]=(.39,.75),(.30,.93),(.60,.74),(.65,.94)
    if kind in ('coat','gesture'): p[6:8]=[(.72,.42),(.68,.25)]
    if kind == 'close':
        p=[(.5+(x-.5)*2.2,.38+(y-.2)*2.2) for x,y in p]
    # Remove far-side eye/ear for genuine profile conditioning.
    if kind in ('table','cup','standing','gesture','walk'):
        p[0]=(.44,p[0][1]); p[15]=None; p[17]=None
    if kind == 'back':
        for i in [0,14,15,16,17]: p[i]=None
    if points is not None: p=points
    limbs=[(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),(1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
    colors=[(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),(0,255,0),(0,255,85),(0,255,170),(0,255,255),(0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]
    im=Image.new('RGB',(832,1216)); d=ImageDraw.Draw(im)
    for i,(a,b) in enumerate(limbs):
        if p[a] is not None and p[b] is not None:
            d.line([(int(p[k][0]*832),int(p[k][1]*1216)) for k in (a,b)],fill=tuple(int(v*.6) for v in colors[i]),width=8)
    for i,point in enumerate(p):
        if point:
            x,y=point[0]*832,point[1]*1216
            d.ellipse((x-5,y-5,x+5,y+5),fill=colors[i])
    im.save(path)

def prepare():
    from PIL import Image
    if MANIFEST.exists(): raise RuntimeError('Manifest already exists; preparation is one-time')
    OUT.mkdir(parents=True, exist_ok=True); INPUT.mkdir(parents=True, exist_ok=True)
    refs={}
    for character in IDENTITIES:
        src=ROOT / f'public/assets/characters/{character}/neutral.webp'
        im=Image.open(src).convert('RGBA')
        bg=Image.new('RGBA', im.size, (235,235,235,255)); bg.alpha_composite(im)
        crop=(105,5,410,320) if character=='sakura' else (115,10,420,335)
        dest=INPUT / f'{character}-face.png'; bg.crop(crop).convert('RGB').save(dest)
        refs[character]={'source':str(src.relative_to(ROOT)), 'source_sha256':digest(src), 'face_crop':list(crop),'input':str(dest),'input_sha256':digest(dest)}
    for kind in {s[2] for scenes in SCENES.values() for s in scenes}: draw_pose(kind,INPUT / f'pose-{kind}.png')
    models={}
    for sub,name in [('checkpoints','animagine-xl-4.0-opt.safetensors'),('clip_vision','CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'),('ipadapter','ip-adapter-plus-face_sdxl_vit-h.safetensors'),('controlnet','controlnet-openpose-sdxl-1.0.safetensors')]:
        model=Path('D:/AI-Image-Video/models') / sub / name
        models[name]={'path':str(model),'sha256':digest(model)}
    manifest=dict(version=1,scope='A1 bounded 24 candidates, no production export',references=refs,models=models,workflow_sha256=digest(WORKFLOW),jobs=make_jobs())
    save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)

def run(limit):
    manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
    require_resolved(manifest['jobs'])
    template=json.loads(WORKFLOW.read_text(encoding='utf8'))
    if digest(WORKFLOW)!=manifest['workflow_sha256']: raise RuntimeError('Workflow changed after prepare')
    if shutil.disk_usage(OUT).free < 30*1024**3: raise RuntimeError('Less than 30 GiB free')
    require_idle(request('/queue'))
    save(OUT/'system-stats.json',request('/system_stats'))
    save(OUT/'node-info.json',request('/object_info'))
    count=0
    for job in manifest['jobs']:
        if job['status']!='planned': continue
        if count>=limit: break
        require_new(job); require_idle(request('/queue'))
        graph=copy.deepcopy(template)
        graph['2']['inputs']['image']=f'{INPUT.name}/{job["character"]}-face.png'
        graph['10']['inputs']['weight']=job['face_weight']
        graph['12']['inputs']['text']=job['prompt']; graph['13']['inputs']['text']=job['negative']
        graph['15']['inputs']['seed']=job['seed']
        graph['20']['inputs']['image']=f'{INPUT.name}/pose-{job["pose"]}.png'
        graph['24']['inputs']['strength']=job['pose_strength']
        graph['17']['inputs']['filename_prefix']=OUT.relative_to('D:/AI-Image-Video/output').as_posix()+'/'+job['id']
        save(OUT/(job['id']+'.prompt.json'),graph)
        job['prompt_sha256']=digest(OUT/(job['id']+'.prompt.json'))
        job['status']='unknown'  # persist intent before uncertain network call
        save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
        started=time.monotonic()
        result=request('/prompt',{'prompt':graph,'client_id':'poker-doku-a1-20260905','extra_data':{'job_id':job['id']}})
        job['prompt_id']=result['prompt_id']; job['status']='submitted'
        save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
        print('SUBMITTED',job['id'],job['prompt_id'],flush=True)
        while time.monotonic()-started<600:
            history=request('/history/'+job['prompt_id']).get(job['prompt_id'])
            if history:
                save(OUT/(job['id']+'.history.json'),history)
                images=history.get('outputs',{}).get('17',{}).get('images',[])
                job['elapsed_seconds']=round(time.monotonic()-started,2)
                if images:
                    item=images[0]; output=Path('D:/AI-Image-Video/output')/item['subfolder']/item['filename']
                    from PIL import Image
                    with Image.open(output) as im:
                        im.load()
                        if im.size!=(832,1216): raise RuntimeError('Unexpected output size')
                    job.update(status='generated',output=str(output),output_sha256=digest(output))
                else: job['status']='failed'
                save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
                print(job['status'].upper(),job['id'],job['elapsed_seconds'],flush=True)
                if job['status']=='failed': raise RuntimeError('Execution failed; inspect history, no automatic retry')
                break
            time.sleep(2)
        else: raise TimeoutError('Uncertain execution; retained submitted ID, no retry')
        count+=1

def sheets():
    from PIL import Image,ImageDraw,ImageOps
    manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
    for character in IDENTITIES:
        jobs=[j for j in manifest['jobs'] if j['character']==character]
        sheet=Image.new('RGB',(4*256,3*416),'#20242b'); d=ImageDraw.Draw(sheet)
        for i,j in enumerate(jobs):
            x,y=(i%4)*256,(i//4)*416
            if 'output' in j:
                thumb=ImageOps.contain(Image.open(j['output']).convert('RGB'),(256,374))
                sheet.paste(thumb,(x,y))
            d.text((x+6,y+376),j['id'],fill='white')
            d.text((x+6,y+392),f"face {j['face_weight']} seed {j['seed']}",fill='white')
        sheet.save(OUT/f'{character}-contact.jpg',quality=92)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['prepare','run','sheets']); parser.add_argument('--limit',type=int,default=24)
    args=parser.parse_args()
    if args.command=='prepare': prepare()
    elif args.command=='run': run(min(max(args.limit,0),24))
    else: sheets()

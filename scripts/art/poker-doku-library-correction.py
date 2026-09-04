"""A1b: explicitly bounded 12-candidate correction, preserving A1 evidence."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('pilot',Path(__file__).with_name('poker-doku-library.py'))
p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
BASE=p.OUT
p.OUT=BASE.with_name('a1b-20260905')
p.MANIFEST=Path(__file__).with_name('poker-doku-library-correction-manifest.json')
p.WORKFLOW=Path(__file__).parent/'workflows/poker-doku-sdxl-correction.json'
p.INPUT=p.INPUT.with_name('poker-doku-a1b-20260905')

# Keep failed scene IDs and narrative actions. Never rename errors into successes.
FIXES={
 ('sakura','card-sort'):('table','(side view:1.35), (looking down:1.35), seated at poker table, (sorting playing cards:1.4), (both hands on table:1.4), arms extended forward, hands spread apart, face-down cards between hands, upright torso, focused expression, medium shot, wooden dojo'),
 ('sakura','resolve'):('close','(three quarter view:1.35), (looking to the left:1.5), looking away from camera, eyes focused on an opponent outside the frame, (determined expression:1.3), serious face, head tilted down slightly, portrait, warm dojo lanterns'),
 ('sakura','table-review'):('back','(from behind:1.55), (back view:1.4), over shoulder camera, seated at green poker table, back of head in foreground, looking down at an open notebook on table, studying notes, chip stacks on table, medium wide composition, evening dojo'),
 ('elena','snow-window'):('standing','(side view:1.4), facing a window, (looking out of window:1.55), face turned away from camera toward falling snow outside, hands resting on windowsill, quiet thoughtful expression, medium wide composition, winter cafe'),
 ('elena','coat-turn'):('coat','(from behind:1.45), three quarter back view, (putting on overcoat:1.5), right hand gripping raised coat collar at shoulder, coat hanging behind back, turning head toward doorway behind her, full body, standing at dojo entrance'),
 ('elena','analysis'):('table','(three quarter side view:1.4), (looking down at poker chips:1.5), leaning forward over green poker felt, both hands resting on table, eyes focused on three neat chip stacks below her face, analytical expression, waist up, quiet dojo with cool overhead lamp'),
}

def prepare():
    if p.MANIFEST.exists(): raise RuntimeError('Correction manifest already exists')
    baseline=json.loads((BASE/'manifest.json').read_text(encoding='utf8'))
    if any(j['status']!='generated' for j in baseline['jobs']): raise RuntimeError('Review complete A1 before A1b')
    p.require_idle(p.request('/queue'))
    p.OUT.mkdir(parents=True,exist_ok=True); p.INPUT.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(BASE/'manifest.json',p.OUT/'parent-manifest.json')
    graph=json.loads((Path(__file__).parent/'workflows/poker-doku-sdxl.json').read_text(encoding='utf8'))
    graph['10']['inputs'].update(start_at=.25,end_at=.85,weight=.2)
    graph['24']['inputs'].update(strength=.8,end_percent=.85)
    graph['2']['inputs']['image']=p.INPUT.name+'/sakura-face.png'
    graph['20']['inputs']['image']=p.INPUT.name+'/pose-table.png'
    graph['17']['inputs']['filename_prefix']='poker-doku-library/a1b-20260905/example'
    p.save(p.WORKFLOW,graph)
    for character in p.IDENTITIES:
        shutil.copyfile(Path(baseline['references'][character]['input']),p.INPUT/f'{character}-face.png')
        baseline['references'][character]['input']=str(p.INPUT/f'{character}-face.png')
    for kind in {v[0] for v in FIXES.values()}:
        points=None
        if kind in ('table','standing','gesture','coat'):
            points=[(.40,.23),(.49,.32),(.46,.33),(.38,.47),(.43,.61),(.55,.34),(.63,.49),(.57,.61),(.47,.61),(.45,.77),(.43,.95),(.55,.61),(.58,.78),(.61,.95),(.42,.21),None,(.48,.23),None]
            if kind=='table':
                points[3:5]=[(.37,.50),(.43,.65)]
                points[6:8]=[(.68,.51),(.61,.65)]
            elif kind=='standing':
                points[3:5]=[(.32,.45),(.24,.47)]
                points[6:8]=[(.40,.47),(.29,.49)]
            elif kind=='gesture': points[3:5]=[(.29,.44),(.16,.38)]
            elif kind=='coat':
                points[6:8]=[(.72,.36),(.60,.25)]
                points[0],points[14],points[16]=(.58,.23),(.56,.21),(.50,.23)
        p.draw_pose(kind,p.INPUT/f'pose-{kind}.png',points)
    jobs=[]
    for i,((character,scene),(pose,action)) in enumerate(FIXES.items()):
        identity=p.IDENTITIES[character]
        if character=='sakura':
            identity=identity.replace('cream cardigan','(cream ivory cardigan:1.45)').replace('navy long skirt','(dark navy long skirt:1.35)')
        for c,weight in enumerate((.2,.35),1):
            old=next(j for j in baseline['jobs'] if j['character']==character and j['scene']==scene)
            job={k:old[k] for k in ['character','scene','width','height']}
            job.update(id=f'{character}-{scene}-b{c}',candidate=c,face_weight=weight,pose_strength=.5 if pose=='close' else .8,
                seed=509020261200+i,pose=pose,status='planned',review_status='unreviewed',
                prompt='1girl, solo, '+action+', '+identity+', fully clothed, refined Japanese visual novel illustration, detailed clean lineart, soft painted shading, masterpiece, best quality, very aesthetic',
                negative=p.NEGATIVE+', (looking at viewer:1.5), (front view:1.4), crossed arms, head on arms, crossed hands, hands on face'+(', pink cardigan, pink skirt, purple cardigan, purple skirt, hair ribbons, multiple hair ornaments' if character=='sakura' else ''))
            jobs.append(job)
    manifest=dict(version=1,scope='A1b authorized correction; six failed scenes x two, no further retries',parent_manifest_sha256=p.digest(BASE/'manifest.json'),models=baseline['models'],references=baseline['references'],workflow_sha256=p.digest(p.WORKFLOW),jobs=jobs)
    p.save(p.MANIFEST,manifest); p.save(p.OUT/'manifest.json',manifest)

if __name__=='__main__':
    if len(sys.argv)!=2 or sys.argv[1] not in ('prepare','run','sheets'): raise SystemExit('Use prepare|run|sheets')
    if sys.argv[1]=='prepare': prepare()
    elif sys.argv[1]=='run': p.run(12)
    else: p.sheets()

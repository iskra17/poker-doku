"""A1c official native Qwen-Image-Edit-2511 recipe: exactly four initial edits.

prepare -> run -> sheets. No daemon, automatic retry, export, or fifth submission.
Source files and all earlier experiments remain unchanged.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
OUT=Path('D:/AI-Image-Video/output/poker-doku-library/a1c-20260905')
INPUT=Path('D:/AI-Image-Video/input/poker-doku-a1c-20260905')
MANIFEST=ROOT/'scripts/art/poker-doku-library-qwen-manifest.json'
WORKFLOW=ROOT/'scripts/art/workflows/poker-doku-qwen-edit-2511.json'
MODELS=Path('D:/AI-Image-Video/models')
MODEL_RECORD=MODELS/'.downloads/poker-doku-qwen-edit-2511.json'
TEMPLATE=Path('C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/Lib/site-packages/comfyui_workflow_templates_json/templates/image_qwen_image_edit_2511_int8.json')
API='http://127.0.0.1:8188'
MODEL_FILES={
 'qwen_image_edit_2511_int8_convrot.safetensors':'11b5af5ac601821d73930c84846c9a158e67177356daf927ce1c8d10f3963829',
 'qwen_2.5_vl_7b_fp8_scaled.safetensors':'cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4',
 'qwen_image_vae.safetensors':'a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f',
 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors':'22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f',
}
SCENES=[
 ('sakura','garden-tea','Move her into a peaceful Japanese garden veranda. Show her seated in a true right-facing profile, her nose pointing toward the right edge of the picture. She gently holds one plain ceramic teacup with both hands at chest height and looks down toward the cup, with a small relieved smile. Frame her from the waist up with the garden visible behind her. Change the original clasped-hands pose into the specified cup-holding pose.'),
 ('sakura','table-review','Place her seated at a green felt poker practice table, studying an open notebook. Position the camera behind her left shoulder: the back of her head and cream cardigan occupy the left foreground, while the notebook and a few neat chip stacks are visible on the table beyond her. Her head is bowed toward the notebook and her eyes look at the page. One hand rests on the notebook and the other hand rests on the felt. Show only a small side contour of her cheek; she must not turn back toward the camera. The notebook has faint abstract lines, no readable text.'),
 ('elena','snow-window','Place her inside a quiet winter cafe beside a large window on the LEFT side of the picture. Rotate her body and head into a LEFT-facing profile so that her eyes look through the window at falling snow outside. The window is in front of her face, not behind her. Her hands rest gently on the windowsill; remove the chip from her original hand. Her expression is thoughtful and restrained. Frame her from the waist up, with warm indoor light and cool snowy light outside.'),
 ('elena','analysis','Place her at a green felt poker table in a quiet dojo, leaning slightly forward while analyzing three neat stacks of chips. Put the camera on her right side, showing a left-facing three-quarter profile. Her eyes are directed DOWN toward the chip stacks on the felt, never toward the viewer. Both hands rest naturally on the tabletop close to the stacks, with fingers separated and no chip held near her face. Use a medium shot from the waist up and a soft cool overhead lamp.'),
]
PRESERVE={
 'sakura':'Keep the same adult 22-year-old woman, her exact soft pink bob haircut, pink eyes, face shape, one small white cherry-blossom hairpin, cream ivory cardigan, white collared blouse and pink neck ribbon. Preserve the original clothing colors, delicate linework, softly painted shading, fine hair highlights and Japanese visual-novel art style.',
 'elena':'Keep the same adult 27-year-old woman, her mature elongated face, narrow grey-blue eyes, defined jawline, very long straight silver hair, small silver hoop earrings, black tailored suit jacket, white collared shirt and pale grey necktie. Do not enlarge or round her eyes or shorten her jaw. Preserve the original clothing colors, fine linework, silky hair highlights, softly painted shading and Japanese visual-novel art style.',
}

def digest(path):
    with Path(path).open('rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def save(path,value):
    path=Path(path); temp=path.with_suffix(path.suffix+'.writing')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8'); os.replace(temp,path)

def request(route,payload=None):
    data=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(API+route,data,{'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:
        body=r.read()
        return json.loads(body) if body else {}

def make_jobs():
    return [dict(id=f'{c}-{scene}-q1',character=c,scene=scene,seed=509020261300+i,
        status='planned',review_status='unreviewed',expected_size=[832,1248],
        prompt='Edit the supplied illustration into a new scene of the SAME woman. '+PRESERVE[c]+' '+action+
            ' The result is one coherent illustration with one fully clothed adult woman. No collage, duplicate person, text, logo or watermark. Preserve her identity and rendering style while changing the camera, pose, gaze and setting as instructed.')
        for i,(c,scene,action) in enumerate(SCENES)]

def validate_jobs(jobs):
    expected={f'{c}-{s}-q1' for c,s,_ in SCENES}
    if len(jobs)!=4 or {j['id'] for j in jobs}!=expected:
        raise ValueError('Initial-four review gate: fifth/unapproved/duplicate job is forbidden')

def require_resolved(jobs):
    if any(j['status'] not in ('planned','generated') for j in jobs):
        raise RuntimeError('Reconcile unresolved prompt IDs before any further submission')

def require_idle(queue):
    if queue.get('queue_running') or queue.get('queue_pending'): raise RuntimeError('GPU queue is occupied')

def make_graph(job):
    # Flattened official int8 template: turbo switch true, no other architecture changes.
    return {
      '1':{'class_type':'UNETLoader','inputs':{'unet_name':'qwen_image_edit_2511_int8_convrot.safetensors','weight_dtype':'default'}},
      '2':{'class_type':'CLIPLoader','inputs':{'clip_name':'qwen_2.5_vl_7b_fp8_scaled.safetensors','type':'qwen_image','device':'default'}},
      '3':{'class_type':'VAELoader','inputs':{'vae_name':'qwen_image_vae.safetensors'}},
      '4':{'class_type':'LoadImage','inputs':{'image':f'{INPUT.name}/{job["character"]}-showcase.png'}},
      '5':{'class_type':'FluxKontextImageScale','inputs':{'image':['4',0]}},
      '6':{'class_type':'ModelSamplingAuraFlow','inputs':{'model':['1',0],'shift':3.1}},
      '7':{'class_type':'CFGNorm','inputs':{'model':['6',0],'strength':1.0,'pre_cfg':False}},
      '8':{'class_type':'TextEncodeQwenImageEditPlus','inputs':{'clip':['2',0],'vae':['3',0],'image1':['5',0],'prompt':job['prompt']}},
      '9':{'class_type':'TextEncodeQwenImageEditPlus','inputs':{'clip':['2',0],'vae':['3',0],'image1':['5',0],'prompt':''}},
      '10':{'class_type':'LoraLoaderModelOnly','inputs':{'model':['7',0],'lora_name':'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors','strength_model':1.0}},
      '11':{'class_type':'FluxKontextMultiReferenceLatentMethod','inputs':{'conditioning':['8',0],'reference_latents_method':'index_timestep_zero'}},
      '12':{'class_type':'FluxKontextMultiReferenceLatentMethod','inputs':{'conditioning':['9',0],'reference_latents_method':'index_timestep_zero'}},
      '13':{'class_type':'VAEEncode','inputs':{'pixels':['5',0],'vae':['3',0]}},
      '15':{'class_type':'KSampler','inputs':{'model':['10',0],'positive':['11',0],'negative':['12',0],'latent_image':['13',0],'seed':job['seed'],'steps':4,'cfg':1.0,'sampler_name':'euler','scheduler':'simple','denoise':1.0}},
      '16':{'class_type':'VAEDecode','inputs':{'samples':['15',0],'vae':['3',0]}},
      '17':{'class_type':'SaveImage','inputs':{'images':['16',0],'filename_prefix':'poker-doku-library/a1c-20260905/'+job['id']}},
    }

def prepare():
    from PIL import Image
    if MANIFEST.exists(): raise RuntimeError('Existing experiment manifest will not be overwritten')
    OUT.mkdir(parents=True,exist_ok=True); INPUT.mkdir(parents=True,exist_ok=True)
    refs={}
    for character in PRESERVE:
        source=ROOT/f'public/assets/characters/{character}/showcase.webp'
        dest=INPUT/f'{character}-showcase.png'
        if dest.exists(): raise RuntimeError('Existing reference input will not be overwritten')
        im=Image.open(source).convert('RGBA')
        background=Image.new('RGBA',im.size,(240,240,240,255)); background.alpha_composite(im)
        background.convert('RGB').save(dest)
        refs[character]=dict(source=str(source.relative_to(ROOT)),source_sha256=digest(source),input=str(dest),input_sha256=digest(dest),size=list(im.size),preparation='Only alpha composited onto neutral grey; no crop or retouch')
    jobs=make_jobs(); validate_jobs(jobs)
    graph=make_graph(jobs[0]); save(WORKFLOW,graph)
    shutil.copyfile(TEMPLATE,OUT/'official-int8-template.json')
    save(OUT/'node-info.json',request('/object_info'))
    manifest=dict(version=1,phase='initial-four',authorized_initial_count=4,total_future_cap=16,
        official_docs='https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511',
        official_template=str(TEMPLATE),official_template_sha256=digest(TEMPLATE),workflow_sha256=digest(WORKFLOW),
        references=refs,models_verified=False,models=[],jobs=jobs,approved_for_export=[])
    save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)

def verify_models():
    records=json.loads(MODEL_RECORD.read_text(encoding='utf8')); result=[]
    for name,expected in MODEL_FILES.items():
        row=next((r for r in records if Path(r['target']).name==name),None)
        if row is None or row['sha256']!=expected: raise RuntimeError('Missing/unverified model '+name)
        target=Path(row['target']).resolve()
        if not target.is_relative_to(MODELS.resolve()): raise ValueError('Model outside approved root')
        if digest(target)!=expected: raise RuntimeError('Actual model hash changed: '+name)
        result.append(row)
    return result

def gpu_sample():
    raw=subprocess.check_output(['nvidia-smi','--query-gpu=memory.used,memory.free,utilization.gpu,temperature.gpu','--format=csv,noheader,nounits'],text=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0)).strip().splitlines()[0]
    used,free,util,temp=[int(s.strip()) for s in raw.split(',')]
    return dict(time=time.time(),used_mib=used,free_mib=free,utilization_percent=util,temperature_c=temp)

def run():
    from PIL import Image
    manifest=json.loads(MANIFEST.read_text(encoding='utf8'))
    validate_jobs(manifest['jobs']); require_resolved(manifest['jobs']); require_idle(request('/queue'))
    if digest(WORKFLOW)!=manifest['workflow_sha256']: raise RuntimeError('Workflow changed since preparation')
    if shutil.disk_usage(OUT).free<30*1024**3: raise RuntimeError('Less than 30 GiB free')
    for ref in manifest['references'].values():
        if digest(ROOT/ref['source'])!=ref['source_sha256'] or digest(ref['input'])!=ref['input_sha256']:
            raise RuntimeError('Reference hash changed')
    manifest['models']=verify_models(); manifest['models_verified']=True
    save(OUT/'system-stats.json',request('/system_stats'))
    for job in manifest['jobs']:
        if job['status']=='generated': continue
        require_idle(request('/queue'))
        if list(OUT.glob(job['id']+'_*.png')): raise RuntimeError('Output already exists; reconcile instead of duplicate')
        graph=json.loads(WORKFLOW.read_text(encoding='utf8'))
        graph['4']['inputs']['image']=f'{INPUT.name}/{job["character"]}-showcase.png'
        graph['8']['inputs']['prompt']=job['prompt']
        graph['15']['inputs']['seed']=job['seed']
        graph['17']['inputs']['filename_prefix']='poker-doku-library/a1c-20260905/'+job['id']
        save(OUT/(job['id']+'.prompt.json'),graph)
        job['prompt_sha256']=digest(OUT/(job['id']+'.prompt.json'))
        job['status']='unknown'; save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
        started=time.monotonic(); metrics=[gpu_sample()]
        response=request('/prompt',{'prompt':graph,'client_id':'poker-doku-a1c-initial-four','extra_data':{'job_id':job['id'],'phase':'initial-four'}})
        job['prompt_id']=response['prompt_id']; job['status']='submitted'
        save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
        print('SUBMITTED',job['id'],job['prompt_id'],flush=True)
        while time.monotonic()-started<900:
            metrics.append(gpu_sample())
            history=request('/history/'+job['prompt_id']).get(job['prompt_id'])
            if history:
                save(OUT/(job['id']+'.history.json'),history); save(OUT/(job['id']+'.gpu.json'),metrics)
                job['elapsed_seconds']=round(time.monotonic()-started,2)
                job['peak_gpu_used_mib']=max(m['used_mib'] for m in metrics)
                images=history.get('outputs',{}).get('17',{}).get('images',[])
                if not images:
                    job['status']='failed'; save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
                    raise RuntimeError('ComfyUI execution failed; retained evidence, no automatic retry')
                item=images[0]; output=Path('D:/AI-Image-Video/output')/item['subfolder']/item['filename']
                if not output.resolve().is_relative_to(OUT.resolve()): raise RuntimeError('Unexpected output location')
                with Image.open(output) as im:
                    im.load()
                    if list(im.size)!=job['expected_size']: raise RuntimeError('Unexpected output dimensions')
                job.update(status='generated',output=str(output),output_sha256=digest(output))
                save(MANIFEST,manifest); save(OUT/'manifest.json',manifest)
                print('GENERATED',job['id'],job['elapsed_seconds'],job['peak_gpu_used_mib'],flush=True)
                break
            time.sleep(2)
        else:
            save(OUT/(job['id']+'.gpu.json'),metrics)
            raise TimeoutError('900 seconds: leave submitted prompt ID for manual reconciliation')
    print('INITIAL_FOUR_COMPLETE: review required before fifth submission',flush=True)

def sheets():
    from PIL import Image,ImageDraw,ImageOps
    manifest=json.loads(MANIFEST.read_text(encoding='utf8')); validate_jobs(manifest['jobs'])
    sheet=Image.new('RGB',(4*416,684),'#20242b'); draw=ImageDraw.Draw(sheet)
    for i,job in enumerate(manifest['jobs']):
        if 'output' in job:
            im=ImageOps.contain(Image.open(job['output']).convert('RGB'),(416,624)); sheet.paste(im,(i*416,0))
        draw.text((i*416+8,630),job['id'],fill='white')
        draw.text((i*416+8,650),f"seed {job['seed']} / {job.get('elapsed_seconds','pending')}s",fill='white')
    sheet.save(OUT/'initial-four-contact.jpg',quality=95)
    for character in PRESERVE:
        jobs=[j for j in manifest['jobs'] if j['character']==character]
        compare=Image.new('RGB',(3*416,654),'#20242b'); d=ImageDraw.Draw(compare)
        reference=ImageOps.contain(Image.open(manifest['references'][character]['input']).convert('RGB'),(416,624)); compare.paste(reference,(0,0)); d.text((8,630),'CANONICAL SHOWCASE',fill='white')
        for i,job in enumerate(jobs,1):
            if 'output' in job:
                im=ImageOps.contain(Image.open(job['output']).convert('RGB'),(416,624)); compare.paste(im,(i*416,0))
            d.text((i*416+8,630),job['id'],fill='white')
        compare.save(OUT/(character+'-reference-compare.jpg'),quality=95)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['prepare','run','sheets']); args=parser.parse_args()
    {'prepare':prepare,'run':run,'sheets':sheets}[args.command]()

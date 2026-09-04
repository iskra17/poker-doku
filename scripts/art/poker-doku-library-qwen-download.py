"""One bounded downloader, pinned official sources, resumable verified HTTP ranges.

Retains partial bytes across failures, never replaces an existing final model.
The inherited Xet partial was probed against official bytes at 0, 1GiB and EOF;
the entire completed file MUST still pass its official SHA-256 before installation.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

ROOT=Path('D:/AI-Image-Video/models').resolve()
STAGING=ROOT/'.downloads'
RECORD=STAGING/'poker-doku-qwen-edit-2511.json'
PLAN=STAGING/'poker-doku-qwen-edit-2511-download-plan.json'
CHUNK=128*1024*1024
ARTIFACTS=[
 ('Comfy-Org/Qwen-Image-Edit_ComfyUI','split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors','diffusion_models','11b5af5ac601821d73930c84846c9a158e67177356daf927ce1c8d10f3963829'),
 ('Comfy-Org/Qwen-Image_ComfyUI','split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors','text_encoders','cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4'),
 ('Comfy-Org/Qwen-Image_ComfyUI','split_files/vae/qwen_image_vae.safetensors','vae','a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f'),
 ('lightx2v/Qwen-Image-Edit-2511-Lightning','Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors','loras','22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f'),
]

def within(root,path):
    path=Path(path).resolve()
    if not path.is_relative_to(Path(root).resolve()): raise ValueError('Path outside model root')
    return path

def verify_range(status,header,start,end,total):
    if status!=206 or header!=f'bytes {start}-{end}/{total}':
        raise ValueError(f'Unexpected range response: {status} {header}')

def save(path,value):
    temp=Path(str(path)+'.writing')
    temp.write_text(json.dumps(value,indent=2),encoding='utf8')
    os.replace(temp,path)

def get_plan():
    if PLAN.exists(): return json.loads(PLAN.read_text(encoding='utf8'))
    jobs=[]; revisions={}
    for repo,remote,folder,expected in ARTIFACTS:
        if repo not in revisions:
            with urllib.request.urlopen('https://huggingface.co/api/models/'+repo,timeout=30) as r:
                revisions[repo]=json.load(r)['sha']
        revision=revisions[repo]
        url=f'https://huggingface.co/{repo}/resolve/{revision}/{remote}'
        req=urllib.request.Request(url,headers={'Range':'bytes=0-0'})
        with urllib.request.urlopen(req,timeout=30) as r:
            header=r.headers.get('Content-Range','')
            match=re.fullmatch(r'bytes 0-0/(\d+)',header)
            if r.status!=206 or not match: raise ValueError('Server does not honor bounded ranges')
            total=int(match[1]); r.read(1)
        name=Path(remote).name
        partial=STAGING/(name+'.range-partial')
        if name=='qwen_image_edit_2511_int8_convrot.safetensors' and not partial.exists():
            inherited=list(STAGING.rglob('*.edcb5fd3.incomplete'))
            if len(inherited)==1: partial=inherited[0]
        jobs.append(dict(repo=repo,file=remote,revision=revision,url=url,expected_sha256=expected,
            target=str(within(ROOT,ROOT/folder/name)),partial=str(within(ROOT,partial)),bytes=total))
    save(PLAN,jobs)
    return jobs

def main():
    STAGING.mkdir(parents=True,exist_ok=True)
    lock=STAGING/'poker-doku-qwen-edit-download.lock'
    with lock.open('x') as f: f.write(str(os.getpid()))
    try:
        records=json.loads(RECORD.read_text(encoding='utf8')) if RECORD.exists() else []
        for job in get_plan():
            target=within(ROOT,job['target']); partial=within(ROOT,job['partial'])
            started=time.monotonic(); errors=0
            if not target.exists():
                offset=partial.stat().st_size if partial.exists() else 0
                if offset>job['bytes']: raise ValueError('Partial is too large')
                if shutil.disk_usage(ROOT).free < job['bytes']-offset+30*1024**3: raise RuntimeError('Insufficient free disk')
                while offset<job['bytes']:
                    end=min(offset+CHUNK,job['bytes'])-1
                    req=urllib.request.Request(job['url'],headers={'Range':f'bytes={offset}-{end}'})
                    try:
                        with urllib.request.urlopen(req,timeout=30) as r:
                            verify_range(r.status,r.headers.get('Content-Range'),offset,end,job['bytes'])
                            with partial.open('ab') as f:
                                remaining=end-offset+1
                                while remaining:
                                    chunk=r.read(min(4*1024*1024,remaining))
                                    if not chunk: raise OSError('Truncated range body')
                                    f.write(chunk); remaining-=len(chunk)
                        offset=partial.stat().st_size
                        print('PROGRESS',target.name,offset,job['bytes'],round(time.monotonic()-started,1),flush=True)
                    except (OSError,TimeoutError) as e:
                        errors+=1; offset=partial.stat().st_size if partial.exists() else 0
                        print('RETRY',errors,target.name,type(e).__name__,str(e),flush=True)
                        if errors>2: raise
                        time.sleep(2)
                with partial.open('rb') as f: checksum=hashlib.file_digest(f,'sha256').hexdigest()
                if checksum!=job['expected_sha256']: raise ValueError('Full model SHA-256 mismatch; retain partial for diagnosis')
                target.parent.mkdir(parents=True,exist_ok=True)
                if target.exists(): raise RuntimeError('Final model appeared; do not overwrite')
                os.rename(partial,target)
            else:
                with target.open('rb') as f: checksum=hashlib.file_digest(f,'sha256').hexdigest()
                if checksum!=job['expected_sha256']: raise ValueError('Existing model SHA-256 mismatch')
            record={k:job[k] for k in ('repo','file','revision','target','bytes')}
            record.update(sha256=checksum,elapsed=round(time.monotonic()-started,2),transport='single sequential HTTP Range, 128MiB')
            records=[r for r in records if r['target']!=str(target)]+[record]
            save(RECORD,records)
            print('VERIFIED',json.dumps(record),flush=True)
    finally:
        lock.unlink(missing_ok=True)

if __name__=='__main__': main()

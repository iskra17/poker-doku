import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from .common import GpuLock, canonical, confined, fingerprint, sha
from .media import inspect_media

EXPORT_LOCK=Path('D:/AI-Image-Video/.poker-doku-export.lock')

def pending_path(root,path):
    """Keep the receipt's lexical name; never unlink a symlink's referent."""
    path=Path(path)
    if path.is_symlink(): raise ValueError('Receipt pending path is a symlink')
    confined(root,path)
    return path

def checked_output(store, job):
    from .external_image import check_external_receipt
    check_external_receipt(store,job)
    if not job['output'] or not job['output_hash']: raise ValueError('Job has no generated result')
    path=confined(store.root,job['output'])
    if sha(path)!=job['output_hash']: raise ValueError('Result changed since generation; previous review is invalid')
    inspect_media(path,job['kind'],store.recipe(job['recipe_hash'])['media'])
    return path

def decide(store,job_id,decision,reason):
    if decision not in ('approved','rejected') or not reason.strip(): raise ValueError('Decision and reason required')
    job=store.job(job_id)
    if job['state'] not in ('generated','approved','rejected','exported'): raise ValueError('Only generated media can be reviewed')
    checked_output(store,job)
    with store.db:
        store.db.execute('INSERT INTO reviews(job_id,output_hash,decision,reason,created) VALUES(?,?,?,?,?)',(job_id,job['output_hash'],decision,reason,time.time()))
        store.db.execute('UPDATE jobs SET state=? WHERE id=?',(decision,job_id))

def require_approval(store,job):
    rows=store.rows('SELECT * FROM reviews WHERE job_id=? ORDER BY id DESC LIMIT 1',(job['id'],))
    if job['state'] not in ('approved','exported') or not rows or rows[0]['decision']!='approved' or rows[0]['output_hash']!=job['output_hash']:
        raise ValueError('Latest review does not approve these exact bytes')

def converter(source,dest,mode,target_root):
    if mode=='cg':
        subprocess.run(['node',str(Path(target_root)/'scripts/art/convert.mjs'),'cg',str(source),str(dest)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
    else:
        subprocess.run(['ffmpeg','-v','error','-nostdin','-i',str(source),'-an','-c:v','libx264','-crf','26','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',str(dest)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)

def export(store,job_id,target_root,relative, *, convert=converter, lock_path=EXPORT_LOCK):
    with GpuLock(lock_path):
        root=Path(target_root).resolve()
        if root!=Path(store.config['target_root']): raise ValueError('Export target is not the immutable approved repository root')
        if Path(relative).is_absolute(): raise ValueError('Export path must be relative')
        job=store.job(job_id); require_approval(store,job); source=checked_output(store,job)
        mode='cg' if job['kind']=='image' else 'video-mp4'
        folder=confined(root,'public/assets/story/cg' if mode=='cg' else 'public/assets/story/video')
        target=confined(root,relative); confined(folder,target)
        from .video_pair import reserved_by_pair
        if reserved_by_pair(store,target): raise ValueError('Target reserved by a video pair')
        if target.suffix.lower()!=('.webp' if mode=='cg' else '.mp4'): raise ValueError('Wrong export extension')
        tool=confined(root,'scripts/art/convert.mjs')
        tool_hash=sha(tool) if mode=='cg' else 'ffmpeg-h264-crf26-medium-faststart-v1'
        settings=fingerprint(dict(mode=mode,tool=tool_hash,width=768 if mode=='cg' else None,height=1152 if mode=='cg' else None))
        export_id=fingerprint(dict(job_id=job_id,source=job['output_hash'],settings=settings,target=str(target)))
        old=store.rows('SELECT * FROM exports WHERE target=?',(str(target),))
        if old:
            row=old[0]
            if row['id']!=export_id: raise ValueError('Export path already reserved by another artifact/settings')
            if target.exists():
                if sha(target)!=row['output_hash']: raise ValueError('Existing export bytes changed; do not overwrite')
                with store.db:
                    store.db.execute("UPDATE exports SET state='complete' WHERE id=?",(export_id,))
                    store.db.execute("UPDATE jobs SET state='exported' WHERE id=?",(job_id,))
                temporary=pending_path(root,target.parent/('.'+target.name+'.art-'+export_id+'.pending'))
                if temporary.exists():
                    if sha(temporary)!=row['output_hash']: raise ValueError('Receipt pending bytes changed; do not remove')
                    temporary.unlink()
                return str(target)
            if row['state']=='complete': raise ValueError('Completed export was removed; explicit investigation required')
            staged=confined(store.root,row['staged'])
            if sha(staged)!=row['output_hash']: raise ValueError('Pending export staging changed')
        else:
            if target.exists(): raise ValueError('Existing game asset collision; never overwrite')
            staged=confined(store.root,Path('exports')/(export_id+target.suffix))
            staged.parent.mkdir(parents=True,exist_ok=True)
            # Unrecorded conversion leftovers are not published or adopted.
            if staged.exists(): raise ValueError('Unrecorded export staging exists; investigate')
            convert(source,staged,mode,root)
            media=dict(width=768,height=1152) if mode=='cg' else store.recipe(job['recipe_hash'])['media']
            info=inspect_media(staged,job['kind'],media)
            checked_output(store,job); require_approval(store,store.job(job_id))
            with store.db:
                store.db.execute('INSERT INTO exports VALUES(?,?,?,?,?,?,?,?,?)',(export_id,job_id,job['output_hash'],settings,str(target),info['sha256'],str(staged),'pending',time.time()))
            row=store.rows('SELECT * FROM exports WHERE id=?',(export_id,))[0]
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=pending_path(root,target.parent/('.'+target.name+'.art-'+export_id+'.pending'))
        # This exact temporary name is owned by the durable pending receipt, never a game file.
        if temporary.exists(): temporary.unlink()
        with staged.open('rb') as src,temporary.open('xb') as dst:
            shutil.copyfileobj(src,dst); dst.flush(); os.fsync(dst.fileno())
        if sha(temporary)!=row['output_hash']: raise ValueError('Export copy changed')
        checked_output(store,job)
        with store.db:
            require_approval(store,store.job(job_id))
            # Atomic no-overwrite publication on the target volume. No os.replace of game assets.
            os.link(temporary,target)
            store.db.execute("UPDATE exports SET state='complete' WHERE id=?",(export_id,))
            store.db.execute("UPDATE jobs SET state='exported' WHERE id=?",(job_id,))
        temporary.unlink()
        return str(target)

def sheet(store):
    from PIL import Image, ImageDraw, ImageOps
    rows=store.rows('SELECT * FROM jobs ORDER BY created,id')
    directory=confined(store.root,'review'); directory.mkdir(parents=True,exist_ok=True)
    pages=[]; cards=[]
    for page,start in enumerate(range(0,len(rows),12),1):
        canvas=Image.new('RGB',(4*240,3*388),'#20242b'); draw=ImageDraw.Draw(canvas)
        for offset,job in enumerate(rows[start:start+12]):
            x=(offset%4)*240; y=(offset//4)*388
            label=job['state']; link=''
            if job['output']:
                try:
                    path=checked_output(store,job); link=path.as_uri()
                    if job['kind']=='image':
                        with Image.open(path) as image: thumb=ImageOps.contain(image.convert('RGB'),(240,344))
                        canvas.paste(thumb,(x,y))
                except (ValueError,OSError): label='INVALID / changed file'
            draw.text((x+4,y+348),job['id'],fill='white'); draw.text((x+4,y+365),label,fill='white')
            spec=json.loads(job['spec'])['job']
            cards.append('<article><h2>'+html.escape(job['id'])+'</h2><p>'+html.escape(label)+'</p><p>'+html.escape(' / '.join(spec[k] for k in ('angle','gaze','expression','outfit')))+'</p>'+('<a href="'+html.escape(link,quote=True)+'">Open full result</a>' if link else '')+'<pre>'+html.escape(job['error'] or '')+'</pre></article>')
        target=directory/f'contact-{page:03}.jpg'; canvas.save(target,quality=92); pages.append(target)
    (directory/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Poker Doku local art review</title><style>body{background:#20242b;color:white;font:16px sans-serif}article{display:inline-block;width:300px;vertical-align:top;padding:16px}a{color:#aad9ff}</style><h1>Local review — no automatic approval</h1>'+''.join('<p><a href="'+p.name+'">'+p.name+'</a></p>' for p in pages)+''.join(cards),encoding='utf8')
    return str(directory/'index.html')

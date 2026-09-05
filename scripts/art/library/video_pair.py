"""Durable, reviewed H3 video pair export. Never updates game availability."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from .common import GpuLock,canonical,confined,fingerprint,sha
from .media import inspect_media
from .review import EXPORT_LOCK,checked_output,require_approval,pending_path

PAIR_SETTINGS=dict(version=1,source_frames=107,frames=106,fps=24,width=768,height=1152,
    max_bytes=2_500_000,mp4=dict(codec='libx264',crf=26,preset='medium'),
    webm=dict(codec='libvpx-vp9',crf=32,cpu_used=4),pixel_format='yuv420p')

def ensure_schema(store):
    # Called only by explicit CPU export under the global export lock. Existing
    # ledgers need no destructive migration or changes to their settings roots.
    store.db.executescript('''
    CREATE TABLE IF NOT EXISTS video_pairs(
      id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),source_hash TEXT NOT NULL,
      settings_hash TEXT NOT NULL,definition TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS video_pair_targets(
      target TEXT PRIMARY KEY,pair_id TEXT NOT NULL REFERENCES video_pairs(id));
    ''')

def reserved_by_pair(store,target):
    if not store.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='video_pair_targets'"): return False
    return bool(store.rows('SELECT target FROM video_pair_targets WHERE target=?',(str(target),)))

def convert_pair(source,paths):
    for ext,path in paths.items():
        settings=PAIR_SETTINGS[ext]
        command=['ffmpeg','-v','error','-nostdin','-n','-i',str(source),'-an',
            '-vf','trim=end_frame=106,setpts=PTS-STARTPTS','-frames:v','106',
            '-r','24','-fps_mode','cfr','-c:v',settings['codec'],'-crf',str(settings['crf']),
            '-pix_fmt','yuv420p','-threads','2']
        if ext=='mp4': command+=['-preset',settings['preset'],'-movflags','+faststart']
        else: command+=['-b:v','0','-cpu-used',str(settings['cpu_used']),'-row-mt','1']
        subprocess.run([*command,str(path)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)

def validate(path,source=False):
    frames=PAIR_SETTINGS['source_frames'] if source else PAIR_SETTINGS['frames']
    expected=dict(width=768,height=1152,frames=frames,fps=24,min_frames=frames,
        min_duration=frames/24-.05,max_duration=frames/24+.05)
    if not source: expected['codec']='h264' if Path(path).suffix=='.mp4' else 'vp9'
    info=inspect_media(path,'video',expected)
    if not source and info['bytes']>PAIR_SETTINGS['max_bytes']: raise ValueError('Pair file exceeds 2,500,000 bytes')
    return info

def export_video_pair(store,job_id,target_root,relative_stem,*,convert=convert_pair,
                      lock_path=EXPORT_LOCK,checkpoint=None):
    checkpoint=checkpoint or (lambda stage:None)
    with GpuLock(lock_path):
        root=Path(target_root).resolve()
        if root!=Path(store.config['target_root']): raise ValueError('Pair target root is not approved')
        if Path(relative_stem).is_absolute() or Path(relative_stem).suffix: raise ValueError('Use a relative extensionless video stem')
        folder=confined(root,'public/assets/story/video'); stem=confined(root,relative_stem); confined(folder,stem)
        job=store.job(job_id); require_approval(store,job)
        if job['kind']!='video': raise ValueError('Pair source must be an approved video')
        source=checked_output(store,job); validate(source,source=True)
        targets={ext:pending_path(folder,Path(str(stem)+'.'+ext)) for ext in ('mp4','webm')}
        settings_hash=fingerprint(PAIR_SETTINGS)
        pair_id=fingerprint(dict(job_id=job_id,source_hash=job['output_hash'],settings_hash=settings_hash,
            targets={ext:str(path) for ext,path in targets.items()}))
        ensure_schema(store)
        existing=store.rows('SELECT * FROM video_pairs WHERE id=?',(pair_id,))
        if existing:
            row=existing[0]; definition=json.loads(row['definition'])
        else:
            for target in targets.values():
                if target.exists() or reserved_by_pair(store,target) or store.rows('SELECT id FROM exports WHERE target=?',(str(target),)):
                    raise ValueError('Video pair target collision; never overwrite')
            definition=dict(id=pair_id,job_id=job_id,source_hash=job['output_hash'],settings=PAIR_SETTINGS,
                parts={ext:dict(target=str(target),staged=str(confined(store.root,Path('exports')/(pair_id+'.'+ext)))) for ext,target in targets.items()})
            with store.db:
                store.db.execute('INSERT INTO video_pairs VALUES(?,?,?,?,?,?,?)',(pair_id,job_id,job['output_hash'],settings_hash,canonical(definition),'preparing',time.time()))
                store.db.executemany('INSERT INTO video_pair_targets VALUES(?,?)',[(str(t),pair_id) for t in targets.values()])
            row=dict(state='preparing')
        paths={ext:pending_path(store.root,part['staged']) for ext,part in definition['parts'].items()}
        if row['state']=='preparing':
            for ext,path in paths.items():
                if targets[ext].exists(): raise ValueError('Unverified target appeared before pair preparation')
                path.parent.mkdir(parents=True,exist_ok=True)
                # The committed pair receipt owns these exact staging names.
                if path.exists(): path.unlink()
            convert(source,paths)
            for ext,path in paths.items(): definition['parts'][ext]['media']=validate(path)
            checked_output(store,job); require_approval(store,store.job(job_id))
            with store.db:
                store.db.execute("UPDATE video_pairs SET definition=?,state='ready' WHERE id=?",(canonical(definition),pair_id))
            checkpoint('after_pair_ready')
        # Validate BOTH staged/published parts before publishing either missing part.
        for ext,part in definition['parts'].items():
            if sha(paths[ext])!=part['media']['sha256']: raise ValueError('Pair staged bytes changed')
            validate(paths[ext])
            if targets[ext].exists() and sha(targets[ext])!=part['media']['sha256']: raise ValueError('Published pair bytes changed')
            if row['state']=='complete' and not targets[ext].exists(): raise ValueError('Completed pair file was removed')
        for ext,target in targets.items():
            part=definition['parts'][ext]
            temporary=pending_path(root,target.parent/('.'+target.name+'.pair-'+pair_id+'.pending'))
            checked_output(store,job); require_approval(store,store.job(job_id))
            if not target.exists():
                target.parent.mkdir(parents=True,exist_ok=True)
                if temporary.exists(): temporary.unlink()
                with paths[ext].open('rb') as src,temporary.open('xb') as dst:
                    shutil.copyfileobj(src,dst); dst.flush(); os.fsync(dst.fileno())
                if sha(temporary)!=part['media']['sha256']: raise ValueError('Pair copy changed')
                with store.db:
                    store.db.execute('UPDATE video_pairs SET state=state WHERE id=?',(pair_id,))
                    require_approval(store,store.job(job_id))
                    os.link(temporary,target)
                checkpoint('after_publish_'+ext)
            if temporary.exists():
                if sha(temporary)!=part['media']['sha256']: raise ValueError('Pair pending bytes changed; do not remove')
                temporary.unlink()
        checked_output(store,job)
        for ext,target in targets.items():
            if sha(target)!=definition['parts'][ext]['media']['sha256']: raise ValueError('Pair changed before completion')
        with store.db:
            store.db.execute('UPDATE video_pairs SET state=state WHERE id=?',(pair_id,))
            require_approval(store,store.job(job_id))
            store.db.execute("UPDATE video_pairs SET state='complete' WHERE id=?",(pair_id,))
            store.db.execute("UPDATE jobs SET state='exported' WHERE id=?",(job_id,))
        return dict(definition,state='complete')
